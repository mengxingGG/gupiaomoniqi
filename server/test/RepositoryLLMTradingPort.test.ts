import { describe, expect, it } from "vitest";
import { AITradingService } from "../src/ai/AITradingService.js";
import { RepositoryLLMTradingPort } from "../src/ai/RepositoryLLMTradingPort.js";
import { LLM_TRADER_PERSONAS } from "../src/ai/LLMPersonas.js";
import { createTestHarness } from "./helpers.js";

describe("RepositoryLLMTradingPort", () => {
  it("固定创建十个 LLM 智能体且不挤占规则 AI 人口", async () => {
    const harness = await createTestHarness();
    const rules = new AITradingService(
      harness.repository,
      harness.tradeService,
      () => 0.5,
      () => new Date(),
      true,
    );
    await rules.ensurePopulation(20);
    const port = new RepositoryLLMTradingPort(
      harness.repository,
      harness.tradeService,
      harness.engine,
      () => new Date(),
    );
    await port.ensureAgents(LLM_TRADER_PERSONAS);
    await port.ensureAgents(LLM_TRADER_PERSONAS);
    await rules.ensurePopulation(20);

    const traders = harness.repository.listAITraders();
    expect(traders.filter((item) => item.traderKind === "LLM")).toHaveLength(10);
    expect(traders.filter((item) => item.traderKind !== "LLM")).toHaveLength(20);
    expect(
      traders
        .filter((item) => item.traderKind === "LLM")
        .map((item) => item.personaKey),
    ).toEqual(LLM_TRADER_PERSONAS.map((persona) => persona.key));
  });

  it("合法模型决策通过统一订单服务成交并持久记录", async () => {
    const harness = await createTestHarness();
    const port = new RepositoryLLMTradingPort(
      harness.repository,
      harness.tradeService,
      harness.engine,
      () => new Date("2026-08-01T12:00:00.000Z"),
    );
    const persona = LLM_TRADER_PERSONAS[0]!;
    await port.ensureAgents([persona]);
    const trader = harness.repository
      .listAITraders()
      .find((item) => item.traderKind === "LLM")!;
    const agent = {
      traderId: trader.id,
      personaKey: persona.key,
      scheduledAt: trader.nextActionAt,
    };
    const context = await port.buildContext(agent);
    const result = await port.executeDecision(
      agent,
      persona,
      context,
      {
        action: "BUY",
        instrumentId: "us-aapl",
        orderType: "MARKET",
        limitPrice: null,
        allocationPercent: 5,
        positionPercent: 0,
        confidence: 0.8,
        reason: "趋势确认",
      },
    );

    expect(result.state).toBe("EXECUTED");
    expect(result.transactionId).toBeDefined();
    expect(harness.repository.listTransactions(trader.portfolioId)).toHaveLength(1);
    expect(
      harness.repository.getPosition(trader.portfolioId, "us-aapl")?.quantity,
    ).toBeGreaterThan(0);
  });

  it("同一调度轮崩溃重放时复用订单幂等键且不会重复成交", async () => {
    const harness = await createTestHarness();
    const port = new RepositoryLLMTradingPort(
      harness.repository,
      harness.tradeService,
      harness.engine,
      () => new Date("2026-08-01T12:00:00.000Z"),
    );
    const persona = LLM_TRADER_PERSONAS[0]!;
    await port.ensureAgents([persona]);
    const trader = harness.repository
      .listAITraders()
      .find((item) => item.personaKey === persona.key)!;
    const agent = {
      traderId: trader.id,
      personaKey: persona.key,
      scheduledAt: trader.nextActionAt,
    };
    const context = await port.buildContext(agent);
    const decision = {
      action: "BUY" as const,
      instrumentId: "us-aapl",
      orderType: "MARKET" as const,
      limitPrice: null,
      allocationPercent: 5,
      positionPercent: 0,
      confidence: 0.8,
      reason: "趋势确认",
    };

    const first = await port.executeDecision(agent, persona, context, decision);
    const replay = await port.executeDecision(agent, persona, context, decision);

    expect(replay.transactionId).toBe(first.transactionId);
    expect(harness.repository.listTransactions(trader.portfolioId)).toHaveLength(1);
    expect(harness.repository.listOrders(trader.portfolioId)).toHaveLength(1);
  });

  it("服务端强制执行智能体的最大持仓标的数", async () => {
    const harness = await createTestHarness();
    const port = new RepositoryLLMTradingPort(
      harness.repository,
      harness.tradeService,
      harness.engine,
      () => new Date("2026-08-01T12:00:00.000Z"),
    );
    const persona = {
      ...LLM_TRADER_PERSONAS[0]!,
      key: "single_position_test",
      maximumPositions: 1,
    };
    await port.ensureAgents([persona]);
    const trader = harness.repository
      .listAITraders()
      .find((item) => item.personaKey === persona.key)!;
    const firstAgent = {
      traderId: trader.id,
      personaKey: persona.key,
      scheduledAt: trader.nextActionAt,
    };
    const firstContext = await port.buildContext(firstAgent);
    await port.executeDecision(firstAgent, persona, firstContext, {
      action: "BUY",
      instrumentId: "us-aapl",
      orderType: "MARKET",
      limitPrice: null,
      allocationPercent: 5,
      positionPercent: 0,
      confidence: 0.8,
      reason: "建立第一只持仓",
    });

    const secondContext = await port.buildContext(firstAgent);
    const rejected = await port.executeDecision(
      firstAgent,
      persona,
      secondContext,
      {
        action: "BUY",
        instrumentId: "hk-00700",
        orderType: "MARKET",
        limitPrice: null,
        allocationPercent: 5,
        positionPercent: 0,
        confidence: 0.8,
        reason: "尝试增加第二只持仓",
      },
    );

    expect(rejected).toMatchObject({
      state: "REJECTED",
      detail: "持仓标的数量已达风控上限",
    });
    expect(
      harness.repository.getPosition(trader.portfolioId, "hk-00700"),
    ).toBeUndefined();
  });

  it("补充资金检查同时计算冻结资金并且只补一次", async () => {
    const harness = await createTestHarness();
    const port = new RepositoryLLMTradingPort(
      harness.repository,
      harness.tradeService,
    );
    const lowCashPersona = {
      ...LLM_TRADER_PERSONAS[0]!,
      key: "low_cash_test",
      initialCashUsd: 50_000,
    };
    await port.ensureAgents([lowCashPersona]);
    const trader = harness.repository
      .listAITraders()
      .find((item) => item.personaKey === lowCashPersona.key)!;

    await expect(
      port.ensureCashFloor(trader.id, 100_000, 1_000_000),
    ).resolves.toBe(true);
    await expect(
      port.ensureCashFloor(trader.id, 100_000, 1_000_000),
    ).resolves.toBe(false);
    expect(
      harness.repository.getPortfolioById(trader.portfolioId),
    ).toMatchObject({
      initialCashUsd: 1_050_000,
      availableCashUsd: 1_050_000,
    });
  });
});
