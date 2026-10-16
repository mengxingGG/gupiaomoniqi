import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantService } from "../src/assistant/AssistantService.js";
import { AssistantError } from "../src/assistant/AssistantStore.js";
import { AssistantTrades, type AssistantTradePort } from "../src/assistant/AssistantTrades.js";
import { TradeError } from "../src/services/TradeService.js";
import { createTestHarness } from "./helpers.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function harness() {
  const h = await createTestHarness(), accountId = h.accountId!, dir = mkdtempSync(join(tmpdir(), "assistant-trades-"));
  cleanup.push(async () => rmSync(dir, { recursive: true, force: true }));
  const port: AssistantTradePort = {
    preview: async (_id, _mode, request) => {
      const stock = h.repository.getInstrumentById(request.instrumentId), quote = h.repository.getQuote(request.instrumentId);
      if (!stock || !quote) throw new AssistantError("标的不存在");
      return { name: stock.name, symbol: stock.symbol, quoteCurrency: quote.quoteCurrency, referencePrice: quote.currentPrice, quoteTime: quote.updatedAt };
    },
    execute: vi.fn(async (id, _mode, request) => {
      try { return await h.tradeService.placeOrder(id, request); }
      catch (e) { if (e instanceof TradeError) throw new AssistantError(e.message, e.statusCode); throw e; }
    }),
  };
  const service = new AssistantService(dir, { trades: port, read: async () => ({}) });
  const app = Fastify(); service.register(app, req => req.headers.authorization === "Bearer owner" ? accountId : req.headers.authorization === "Bearer other" ? "other" : undefined);
  await app.ready(); cleanup.push(async () => { await service.close(); await app.close(); });
  const request = async (method: "GET" | "POST" | "DELETE", path: string, payload: unknown = {}, token = "owner") => {
    const result = await app.inject({ method, url: `/api/assistant${path}`, headers: { authorization: `Bearer ${token}` }, ...(method === "GET" ? {} : { payload }) });
    return { status: result.statusCode, data: result.json().data };
  };
  const sid = (await request("POST", "/sessions", { mode: "VIRTUAL" })).data.id;
  const propose = (input: object = {}) => service.trades.propose(accountId, sid, randomUUID(), randomUUID(),
    { instrumentId: "us-aapl", side: "BUY", quantity: 10, orderMode: "MARKET", reason: "练习分批建仓", ...input }, new AbortController().signal);
  const approve = (id: string) => request("POST", `/sessions/${sid}/trades/${id}/approve`);
  const snapshot = () => h.portfolioService.getSnapshot(accountId);
  return { ...h, accountId, dir, port, service, request, sid, propose, approve, snapshot };
}

describe("assistant trade approval through normal order services", () => {
  it("does not spend on proposal; explicit approval buys once, then sell updates positions and cash", async () => {
    const h = await harness(), buy = await h.propose();
    expect(h.snapshot().availableCashUsd).toBe(1_000_000); expect(h.port.execute).not.toHaveBeenCalled();
    const [a, b] = await Promise.all([h.approve(buy.id), h.approve(buy.id)]);
    expect(a.data.result.orderId).toBe(b.data.result.orderId); expect(h.port.execute).toHaveBeenCalledTimes(1);
    expect(h.snapshot().positions[0]?.quantity).toBe(10); expect(h.snapshot().availableCashUsd).toBe(998799);
    expect((await h.approve(buy.id)).data.status).toBe("submitted"); expect(h.port.execute).toHaveBeenCalledTimes(1);
    const sell = await h.propose({ side: "SELL", quantity: 4 });
    expect((await h.approve(sell.id)).data.result).toMatchObject({ status: "FILLED", filledQuantity: 4 });
    expect(h.snapshot().positions[0]?.quantity).toBe(6); expect(h.snapshot().availableCashUsd).toBe(999278);
  });
  it("checks account ownership, authentication and immutable approval payload", async () => {
    const h = await harness(), card = await h.propose(), path = `/sessions/${h.sid}/trades/${card.id}/approve`;
    expect((await h.request("POST", path, {}, "missing")).status).toBe(401);
    expect((await h.request("POST", path, {}, "other")).status).toBe(404);
    expect((await h.request("POST", path, { quantity: 100000, mode: "REAL" })).status).toBe(400);
    await expect(h.propose({ approved: true })).rejects.toThrow();
    await expect(h.propose({ mode: "REAL" })).rejects.toThrow();
    expect(h.port.execute).not.toHaveBeenCalled();
  });
  it("uses normal limit-order fund freezing and T+1 / insufficient funds validation", async () => {
    const h = await harness(), limit = await h.propose({ orderMode: "LIMIT", limitPrice: 110 });
    expect((await h.approve(limit.id)).data.result.status).toBe("OPEN"); expect(h.snapshot().frozenCashUsd).toBe(1101);
    const huge = await h.propose({ quantity: 10000000 });
    expect((await h.approve(huge.id)).data.status).toBe("failed");
    const buy = await h.propose({ instrumentId: "cn-600519", quantity: 100 }); await h.approve(buy.id);
    const sell = await h.propose({ instrumentId: "cn-600519", quantity: 100, side: "SELL" });
    expect((await h.approve(sell.id)).data.status).toBe("failed");
    expect(h.snapshot().positions.find(p => p.instrumentId === "cn-600519")?.availableQuantity).toBe(0);
  });
  it("rejected and expired cards never execute, and stopping before persistence creates no card", async () => {
    const h = await harness(), card = await h.propose();
    await h.request("POST", `/sessions/${h.sid}/trades/${card.id}/reject`);
    expect((await h.approve(card.id)).status).toBe(409);
    const expired = await h.propose();
    h.service.store.change(h.accountId, s => { s.sessions[0]!.tradeProposals!.find(p => p.id === expired.id)!.expiresAt = "2000-01-01T00:00:00Z"; });
    expect((await h.approve(expired.id)).data.status).toBe("expired");
    const controller = new AbortController(); controller.abort();
    await expect(h.service.trades.propose(h.accountId, h.sid, "m", "c", { instrumentId: "us-aapl", side: "BUY", quantity: 1, reason: "test" }, controller.signal)).rejects.toThrow();
    expect(h.service.session(h.accountId, h.sid).tradeProposals).toHaveLength(2); expect(h.port.execute).not.toHaveBeenCalled();
  });
  it("recovers committed-but-unacknowledged execution after restart with the same order id", async () => {
    const h = await harness(), card = await h.propose(), original = h.port.execute;
    h.port.execute = async (...args) => { await original(...args); throw new Error("connection lost after commit"); };
    expect((await h.approve(card.id)).data.status).toBe("uncertain");
    expect((await h.request("DELETE", `/sessions/${h.sid}`)).status).toBe(409);
    h.port.execute = original;
    const restarted = new AssistantTrades(h.service.store, h.port);
    const recovered = await restarted.approve(h.accountId, h.sid, card.id);
    expect(recovered.status).toBe("submitted"); expect(h.snapshot().positions[0]?.quantity).toBe(10);
    expect(h.repository.listTransactions(h.repository.getPortfolioByAccountId(h.accountId)!.id)).toHaveLength(1);
    expect((await h.request("DELETE", `/sessions/${h.sid}`)).status).toBe(200);
  });
  it("keeps a card while an approved order is executing, and persists it across service restart", async () => {
    const h = await harness(), card = await h.propose(), original = h.port.execute;
    let unblock!: () => void; const gate = new Promise<void>(resolve => { unblock = resolve; });
    h.port.execute = async (...args) => { await gate; return original(...args); };
    const execution = h.service.trades.approve(h.accountId, h.sid, card.id);
    expect((await h.request("DELETE", `/sessions/${h.sid}`)).status).toBe(409);
    expect(h.service.overview(h.accountId).sessions[0]?.tradeProposals?.[0]?.status).toBe("executing");
    unblock(); await execution;
    const restarted = new AssistantService(h.dir, { trades: h.port, read: async () => ({}) });
    expect(restarted.session(h.accountId, h.sid).tradeProposals?.[0]?.status).toBe("submitted"); await restarted.close();
  });
  it("fixes the proposal market to the session, rather than trusting model input", async () => {
    const h = await harness();
    const real = (await h.request("POST", "/sessions", { mode: "REAL" })).data.id;
    const preview = vi.spyOn(h.port, "preview");
    const card = await h.service.trades.propose(h.accountId, real, "m", "c", { instrumentId: "us-aapl", side: "BUY", quantity: 1, reason: "test" }, new AbortController().signal);
    expect(card.mode).toBe("REAL"); expect(preview).toHaveBeenCalledWith(h.accountId, "REAL", expect.anything());
  });
});
