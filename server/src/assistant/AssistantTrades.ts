import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AssistantSession, AssistantTradeProposal, OrderSubmissionResult, TradeRequest } from "@gupiaomoniqi/shared";
import { AssistantError, AssistantStore } from "./AssistantStore.js";

export const proposalSchema = z.object({ instrumentId: z.string().trim().min(1).max(120), side: z.enum(["BUY", "SELL"]),
  quantity: z.number().int().positive().max(100000000), orderMode: z.enum(["MARKET", "LIMIT"]).default("MARKET"),
  limitPrice: z.number().positive().finite().optional(), reason: z.string().trim().min(1).max(1500),
}).strict().superRefine((v, ctx) => {
  if ((v.orderMode === "LIMIT") !== (v.limitPrice !== undefined)) ctx.addIssue({ code: "custom", message: "限价单必须填写限价，市价单不能填写限价" });
});
export interface AssistantTradePort {
  preview(accountId: string, mode: "VIRTUAL" | "REAL", request: TradeRequest): Promise<{
    name: string; symbol: string; quoteCurrency: string; referencePrice: number; quoteTime: string;
  }>;
  execute(accountId: string, mode: "VIRTUAL" | "REAL", request: TradeRequest): Promise<OrderSubmissionResult>;
}

/** 模型只能提案；确认入口仅供已登录客户端调用，最终执行复用正常订单服务。 */
export class AssistantTrades {
  private readonly pending = new Map<string, Promise<AssistantTradeProposal>>();
  constructor(private readonly store: AssistantStore, private readonly port?: AssistantTradePort, private readonly clock = () => new Date()) {}
  enabled() { return Boolean(this.port); }
  async close() { await Promise.allSettled(this.pending.values()); }
  private session(accountId: string, sessionId: string) {
    const session = this.store.read(accountId).sessions.find(s => s.id === sessionId);
    if (!session) throw new AssistantError("会话不存在", 404);
    return session;
  }
  private proposal(accountId: string, sessionId: string, proposalId: string) {
    const proposal = this.session(accountId, sessionId).tradeProposals?.find(p => p.id === proposalId);
    if (!proposal) throw new AssistantError("授权卡不存在", 404);
    return proposal;
  }
  private update(accountId: string, sessionId: string, proposalId: string, fn: (p: AssistantTradeProposal) => void) {
    return this.store.change(accountId, state => {
      const proposal = state.sessions.find(s => s.id === sessionId)?.tradeProposals?.find(p => p.id === proposalId);
      if (!proposal) throw new AssistantError("授权卡不存在", 404);
      fn(proposal); return proposal;
    });
  }
  refresh(accountId: string) {
    const state = this.store.read(accountId), now = this.clock().getTime();
    const stale = state.sessions.some(s => s.tradeProposals?.some(p => p.status === "pending" && Date.parse(p.expiresAt) <= now ||
      p.status === "executing" && !this.pending.has(`${accountId}:${p.id}`)));
    if (!stale) return;
    this.store.change(accountId, state => state.sessions.forEach(s => s.tradeProposals?.forEach(p => {
      if (p.status === "pending" && Date.parse(p.expiresAt) <= now) p.status = "expired";
      if (p.status === "executing" && !this.pending.has(`${accountId}:${p.id}`)) { p.status = "uncertain"; p.error = "服务中断，请核对本卡执行结果；不会自动重新下单"; }
    })));
  }
  assertDeletable(session: AssistantSession) {
    if (session.tradeProposals?.some(p => ["executing", "uncertain"].includes(p.status)))
      throw new AssistantError("此会话有正在执行或待核对的交易，请先查看授权卡结果再删除", 409);
  }
  async propose(accountId: string, sessionId: string, messageId: string, callId: string, input: unknown, signal: AbortSignal) {
    if (!this.port) throw new AssistantError("当前服务器未启用模拟交易授权卡");
    const request = proposalSchema.parse(input), session = this.session(accountId, sessionId);
    const existing = session.tradeProposals?.find(p => p.messageId === messageId && p.callId === callId);
    if (existing) return existing;
    if ((session.tradeProposals?.length ?? 0) >= 50) throw new AssistantError("本会话授权卡已达上限，请新建会话");
    const preview = await this.port.preview(accountId, session.scope.mode, request); signal.throwIfAborted();
    const now = this.clock();
    const card: AssistantTradeProposal = { ...request, ...preview, id: randomUUID(), messageId, callId, mode: session.scope.mode,
      estimatedAmount: Number(((request.limitPrice ?? preview.referencePrice) * request.quantity).toFixed(2)),
      createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(), status: "pending" };
    this.store.change(accountId, state => {
      const current = state.sessions.find(s => s.id === sessionId);
      if (!current) throw new AssistantError("会话已被删除", 404);
      (current.tradeProposals ??= []).push(card);
    });
    return card;
  }
  reject(accountId: string, sessionId: string, proposalId: string) {
    return this.update(accountId, sessionId, proposalId, p => {
      if (p.status === "rejected" || p.status === "expired") return;
      if (p.status !== "pending") throw new AssistantError("该卡已处理，不能拒绝已授权的委托", 409);
      p.status = "rejected";
    });
  }
  approve(accountId: string, sessionId: string, proposalId: string): Promise<AssistantTradeProposal> {
    if (!this.port) return Promise.reject(new AssistantError("模拟交易授权卡暂不可用"));
    const key = `${accountId}:${proposalId}`, running = this.pending.get(key);
    if (running) { this.proposal(accountId, sessionId, proposalId); return running; }
    const proposal = this.proposal(accountId, sessionId, proposalId);
    if (proposal.status === "submitted") return Promise.resolve(proposal);
    if (!["pending", "uncertain", "executing"].includes(proposal.status)) return Promise.reject(new AssistantError("该授权卡已失效或处理，请让助手重新提出方案", 409));
    if (proposal.status === "pending" && Date.parse(proposal.expiresAt) <= this.clock().getTime())
      return Promise.resolve(this.update(accountId, sessionId, proposalId, p => { p.status = "expired"; }));
    const recovering = proposal.status !== "pending";
    this.update(accountId, sessionId, proposalId, p => { p.status = "executing"; p.approvedAt ??= this.clock().toISOString(); delete p.error; });
    const done = Promise.resolve().then(async () => {
      try {
        const result = await this.port!.execute(accountId, proposal.mode, { instrumentId: proposal.instrumentId, side: proposal.side, quantity: proposal.quantity,
          orderMode: proposal.orderMode, limitPrice: proposal.limitPrice, idempotencyKey: `assistant-${proposal.id}` });
        return this.update(accountId, sessionId, proposalId, p => {
          p.status = "submitted"; p.result = { orderId: result.order.id, status: result.order.status, filledQuantity: result.order.filledQuantity,
            ...(result.transaction ? { price: result.transaction.quotePrice, feeUsd: result.transaction.feeUsd } : {}) };
        });
      } catch (error) {
        return this.update(accountId, sessionId, proposalId, p => {
          p.status = error instanceof AssistantError && !recovering ? "failed" : "uncertain";
          p.error = error instanceof AssistantError ? error.message : "执行结果待核对，请点击核对本卡或到订单页查看；不要重复创建相同交易";
        });
      } finally { this.pending.delete(key); }
    });
    this.pending.set(key, done); return done;
  }
}
