import { describe, expect, it, vi } from "vitest";
import { LLMClientError, type LLMDecisionClient } from "../src/ai/LLMTradingClient.js";
import type { LLMTradingContext } from "../src/ai/LLMMarketContext.js";
import type { LLMTraderPersona } from "../src/ai/LLMPersonas.js";
import {
  LLMTradingService,
  type LLMAgentRunCompletion,
  type LLMDecisionExecutionResult,
  type LLMTraderAgent,
  type LLMTradingPort,
} from "../src/ai/LLMTradingService.js";
import type { LLMTradingConfig } from "../src/config/RootConfig.js";

describe("LLMTradingService", () => {
  it("创建十种固定人格并在合法决策后通过统一端口执行", async () => {
    const events: string[] = [];
    const port = new FakePort(events);
    const client: LLMDecisionClient = {
      checkAvailability: async () => undefined,
      requestDecision: async () => {
        events.push("model");
        return buyDecision();
      },
    };
    const service = new LLMTradingService(
      config(),
      client,
      port,
      () => new Date("2026-08-01T12:00:00.000Z"),
      () => 0.5,
    );

    await service.ensurePopulation();
    expect(port.personas).toHaveLength(10);
    expect(port.personas.map((item) => item.initialCashUsd)).toEqual([
      10_000_000,
      15_000_000,
      20_000_000,
      22_000_000,
      25_000_000,
      30_000_000,
      35_000_000,
      40_000_000,
      45_000_000,
      50_000_000,
    ]);

    const round = await service.runDue();
    expect(round).toMatchObject({ dueAgents: 1, completedAgents: 1, executed: 1 });
    expect(events).toEqual(["context", "model", "cash", "execute", "complete"]);
    expect(port.cashRequest).toEqual({
      traderId: "trader-1",
      thresholdUsd: 100_000,
      topUpUsd: 1_000_000,
    });
    expect(service.getStatus()).toMatchObject({
      completedRequests: 1,
      runningRequests: 0,
    });
    expect(service.getStatus().lastRequestLatencyMs).toBeGreaterThanOrEqual(0);
    expect(service.getStatus().averageRequestLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it("通讯失败不补资金、不执行并开启熔断", async () => {
    const events: string[] = [];
    const port = new FakePort(events);
    const client: LLMDecisionClient = {
      checkAvailability: async () => undefined,
      requestDecision: async () => {
        events.push("model");
        throw new LLMClientError("NETWORK", "offline");
      },
    };
    const service = new LLMTradingService(
      config(),
      client,
      port,
      () => new Date("2026-08-01T12:00:00.000Z"),
    );

    const first = await service.runDue();
    const second = await service.runDue();

    expect(first.errors).toBe(1);
    expect(second.dueAgents).toBe(0);
    expect(events).toEqual(["context", "model", "complete"]);
    expect(port.cashRequest).toBeNull();
    expect(service.getStatus()).toMatchObject({
      providerFailures: 1,
      lastError: "offline",
      circuitOpenUntil: "2026-08-01T12:01:00.000Z",
    });
  });

  it("候选集外决策无任何资金或交易副作用", async () => {
    const events: string[] = [];
    const port = new FakePort(events);
    const client: LLMDecisionClient = {
      checkAvailability: async () => undefined,
      requestDecision: async () => ({ ...buyDecision(), instrumentId: "real-aapl" }),
    };
    const service = new LLMTradingService(
      config(),
      client,
      port,
      () => new Date("2026-08-01T12:00:00.000Z"),
    );

    expect((await service.runDue()).errors).toBe(1);
    expect(events).toEqual(["context", "complete"]);
    expect(port.cashRequest).toBeNull();
  });

  it("模型探测失败时不创建智能体且运行时按熔断旁路", async () => {
    const events: string[] = [];
    const port = new FakePort(events);
    const ensureSpy = vi.spyOn(port, "ensureAgents");
    const client: LLMDecisionClient = {
      checkAvailability: async () => {
        throw new LLMClientError("NETWORK", "model offline");
      },
      requestDecision: async () => buyDecision(),
    };
    const service = new LLMTradingService(
      config(),
      client,
      port,
      () => new Date("2026-08-01T12:00:00.000Z"),
    );

    await expect(service.ensurePopulation()).resolves.toBe(false);
    expect((await service.runDue()).dueAgents).toBe(0);
    expect(ensureSpy).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("连续 HOLD 从第二次开始保守延长调度且交易后恢复正常频率", async () => {
    const events: string[] = [];
    const port = new FakePort(events);
    port.contextValue = {
      ...context(),
      recentActivity: [
        {
          at: "2026-08-01T11:58:00.000Z",
          action: "HOLD",
          instrumentId: null,
          result: "HOLD",
        },
        {
          at: "2026-08-01T11:59:00.000Z",
          action: "HOLD",
          instrumentId: null,
          result: "HOLD",
        },
      ],
    };
    port.executionResult = { state: "HOLD" };
    const service = new LLMTradingService(
      config(),
      {
        checkAvailability: async () => undefined,
        requestDecision: async () => holdDecision(),
      },
      port,
      () => new Date("2026-08-01T12:00:00.000Z"),
      () => 0.5,
    );

    expect((await service.runDue()).held).toBe(1);
    expect(port.completion?.nextActionAt).toBe(
      "2026-08-01T12:04:00.000Z",
    );

    port.contextValue = context();
    port.executionResult = { state: "EXECUTED", transactionId: "tx-2" };
    expect((await service.runDue()).executed).toBe(1);
    expect(port.completion?.nextActionAt).toBe(
      "2026-08-01T12:01:00.000Z",
    );
  });
});

class FakePort implements LLMTradingPort {
  personas: readonly LLMTraderPersona[] = [];
  contextValue = context();
  executionResult: LLMDecisionExecutionResult = {
    state: "EXECUTED",
    transactionId: "tx-1",
  };
  completion: LLMAgentRunCompletion | null = null;
  cashRequest: {
    traderId: string;
    thresholdUsd: number;
    topUpUsd: number;
  } | null = null;

  constructor(private readonly events: string[]) {}

  async ensureAgents(personas: readonly LLMTraderPersona[]): Promise<void> {
    this.personas = personas;
  }

  async listDueAgents(): Promise<LLMTraderAgent[]> {
    return [{
      traderId: "trader-1",
      personaKey: "guardian",
      scheduledAt: "2026-08-01T11:59:00.000Z",
    }];
  }

  async buildContext(): Promise<LLMTradingContext> {
    this.events.push("context");
    return this.contextValue;
  }

  async ensureCashFloor(
    traderId: string,
    thresholdUsd: number,
    topUpUsd: number,
  ): Promise<boolean> {
    this.events.push("cash");
    this.cashRequest = { traderId, thresholdUsd, topUpUsd };
    return true;
  }

  async executeDecision(): Promise<LLMDecisionExecutionResult> {
    this.events.push("execute");
    return this.executionResult;
  }

  async completeAgentRun(
    _agent: LLMTraderAgent,
    completion: LLMAgentRunCompletion,
  ): Promise<void> {
    this.events.push("complete");
    this.completion = completion;
  }
}

function config(): LLMTradingConfig {
  return {
    enabled: true,
    baseUrl: "http://127.0.0.1:8080/v1",
    modelId: "local-model",
    apiKey: "",
    agentCount: 10,
    contextWindow: 32_768,
    requestTimeoutMs: 300_000,
    decisionIntervalMs: 60_000,
    maxConcurrency: 1,
    maxOutputTokens: 512,
    temperature: 0.35,
    circuitBackoffMs: 60_000,
    circuitMaximumBackoffMs: 300_000,
  };
}

function buyDecision() {
  return {
    action: "BUY",
    instrumentId: "us-aapl",
    orderType: "MARKET",
    limitPrice: null,
    allocationPercent: 5,
    positionPercent: 0,
    confidence: 0.8,
    reason: "趋势和订单流一致",
  };
}

function holdDecision() {
  return {
    action: "HOLD",
    instrumentId: null,
    orderType: null,
    limitPrice: null,
    allocationPercent: 0,
    positionPercent: 0,
    confidence: 0.7,
    reason: "当前没有足够优势",
  };
}

function context(): LLMTradingContext {
  return {
    now: "2026-08-01T12:00:00.000Z",
    portfolio: {
      availableCashUsd: 10_000_000,
      frozenCashUsd: 0,
      totalAssetsUsd: 10_000_000,
      profitLossUsd: 0,
      profitLossPercent: 0,
    },
    positions: [],
    openOrders: [],
    marketOverview: { US: { advancing: 100, declining: 80 } },
    candidates: [
      {
        instrumentId: "us-aapl",
        symbol: "AAPL",
        name: "苹果",
        market: "US",
        quoteCurrency: "USD",
        settlementCycle: "T0",
        lotSize: 1,
        currentPrice: 120,
        previousClose: 118,
        changePercent: 1.69,
        openPrice: 119,
        highPrice: 121,
        lowPrice: 118,
        volume: 100_000,
        liquidity: 10_000,
        volatility: 0.0017,
      },
    ],
    recentActivity: [],
    rules: { dailyPriceLimitPercent: 10 },
  };
}
