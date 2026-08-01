import type { LLMTradingConfig } from "../config/RootConfig.js";
import {
  LLMClientError,
  type LLMDecisionClient,
} from "./LLMTradingClient.js";
import {
  LLMDecisionValidationError,
  parseLLMTradeDecision,
  type LLMTradeDecision,
} from "./LLMDecisionSchema.js";
import {
  buildLLMDecisionPrompt,
  type LLMTradingContext,
} from "./LLMMarketContext.js";
import {
  selectLLMTraderPersonas,
  type LLMTraderPersona,
} from "./LLMPersonas.js";

const CASH_FLOOR_USD = 100_000;
const CASH_TOP_UP_USD = 1_000_000;

export interface LLMTraderAgent {
  traderId: string;
  personaKey: string;
  scheduledAt: string;
}

export interface LLMDecisionExecutionResult {
  state: "HOLD" | "EXECUTED" | "PENDING" | "REJECTED";
  detail?: string;
  orderId?: string;
  transactionId?: string;
}

export interface LLMAgentRunCompletion {
  completedAt: string;
  nextActionAt: string;
  state: "HOLD" | "EXECUTED" | "PENDING" | "REJECTED" | "ERROR";
  modelId: string;
  decision: LLMTradeDecision | null;
  detail: string | null;
}

export interface LLMTradingPort {
  ensureAgents(personas: readonly LLMTraderPersona[]): Promise<void>;
  listDueAgents(at: string, limit: number): Promise<LLMTraderAgent[]>;
  buildContext(agent: LLMTraderAgent): Promise<LLMTradingContext>;
  ensureCashFloor(
    traderId: string,
    thresholdUsd: number,
    topUpUsd: number,
  ): Promise<boolean>;
  executeDecision(
    agent: LLMTraderAgent,
    persona: LLMTraderPersona,
    context: LLMTradingContext,
    decision: LLMTradeDecision,
  ): Promise<LLMDecisionExecutionResult>;
  completeAgentRun(
    agent: LLMTraderAgent,
    completion: LLMAgentRunCompletion,
  ): Promise<void>;
}

export interface LLMTradingRoundResult {
  dueAgents: number;
  completedAgents: number;
  executed: number;
  pending: number;
  held: number;
  rejected: number;
  errors: number;
  circuitOpenUntil: string | null;
}

export interface LLMTradingServiceStatus {
  enabled: true;
  modelId: string;
  agentCount: number;
  runningRequests: number;
  providerFailures: number;
  lastSuccessAt: string | null;
  lastError: string | null;
  circuitOpenUntil: string | null;
}

export class LLMTradingService {
  readonly #personas: readonly LLMTraderPersona[];
  readonly #personaByKey: ReadonlyMap<string, LLMTraderPersona>;
  #providerFailures = 0;
  #circuitOpenUntilMs = 0;
  #runningRequests = 0;
  #lastSuccessAt: string | null = null;
  #lastError: string | null = null;
  #populationReady = false;

  constructor(
    private readonly config: LLMTradingConfig,
    private readonly client: LLMDecisionClient,
    private readonly port: LLMTradingPort,
    private readonly clock: () => Date = () => new Date(),
    private readonly random: () => number = Math.random,
  ) {
    this.#personas = selectLLMTraderPersonas(config.agentCount);
    this.#personaByKey = new Map(this.#personas.map((persona) => [persona.key, persona]));
  }

  async ensurePopulation(signal?: AbortSignal): Promise<boolean> {
    const now = this.clock();
    if (signal?.aborted || this.#circuitOpenUntilMs > now.getTime()) {
      return false;
    }
    try {
      await this.client.checkAvailability(signal);
      await this.port.ensureAgents(this.#personas);
      this.#populationReady = true;
      this.#providerFailures = 0;
      this.#circuitOpenUntilMs = 0;
      this.#lastError = null;
      return true;
    } catch (error) {
      if (error instanceof LLMClientError && error.code === "ABORTED") {
        return false;
      }
      this.#openCircuit(safeErrorMessage(error), now);
      return false;
    }
  }

  getStatus(): LLMTradingServiceStatus {
    const now = this.clock().getTime();
    return {
      enabled: true,
      modelId: this.config.modelId,
      agentCount: this.#personas.length,
      runningRequests: this.#runningRequests,
      providerFailures: this.#providerFailures,
      lastSuccessAt: this.#lastSuccessAt,
      lastError: this.#lastError,
      circuitOpenUntil:
        this.#circuitOpenUntilMs > now
          ? new Date(this.#circuitOpenUntilMs).toISOString()
          : null,
    };
  }

  async runDue(signal?: AbortSignal): Promise<LLMTradingRoundResult> {
    const now = this.clock();
    if (signal?.aborted || this.#circuitOpenUntilMs > now.getTime()) {
      return emptyRound(this.getStatus().circuitOpenUntil);
    }
    if (!this.#populationReady && !(await this.ensurePopulation(signal))) {
      return emptyRound(this.getStatus().circuitOpenUntil);
    }

    const agents = await this.port.listDueAgents(
      now.toISOString(),
      this.#personas.length,
    );
    const result = emptyRound(null);
    result.dueAgents = agents.length;
    let cursor = 0;
    const workerCount = Math.min(this.config.maxConcurrency, agents.length);

    const worker = async (): Promise<void> => {
      while (cursor < agents.length && !signal?.aborted) {
        if (this.#circuitOpenUntilMs > this.clock().getTime()) {
          break;
        }
        const index = cursor;
        cursor += 1;
        const agent = agents[index];
        if (!agent) {
          continue;
        }
        const state = await this.#runAgent(agent, signal);
        result.completedAgents += 1;
        switch (state) {
          case "EXECUTED":
            result.executed += 1;
            break;
          case "PENDING":
            result.pending += 1;
            break;
          case "HOLD":
            result.held += 1;
            break;
          case "REJECTED":
            result.rejected += 1;
            break;
          default:
            result.errors += 1;
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    result.circuitOpenUntil = this.getStatus().circuitOpenUntil;
    return result;
  }

  async #runAgent(
    agent: LLMTraderAgent,
    signal?: AbortSignal,
  ): Promise<LLMAgentRunCompletion["state"]> {
    const persona = this.#personaByKey.get(agent.personaKey);
    if (!persona) {
      return this.#completeFailure(agent, "未知 LLM 人格", false);
    }

    let context: LLMTradingContext;
    try {
      context = await this.port.buildContext(agent);
    } catch (error) {
      return this.#completeFailure(agent, safeErrorMessage(error), false);
    }

    const allowedIds = new Set(context.candidates.map((candidate) => candidate.instrumentId));
    try {
      const prompt = buildLLMDecisionPrompt(persona, context, this.config.contextWindow);
      this.#runningRequests += 1;
      let rawDecision: unknown;
      try {
        rawDecision = await this.client.requestDecision(prompt, signal);
      } finally {
        this.#runningRequests -= 1;
      }
      const decision = parseLLMTradeDecision(rawDecision, allowedIds, persona);

      this.#providerFailures = 0;
      this.#circuitOpenUntilMs = 0;
      this.#lastError = null;
      this.#lastSuccessAt = this.clock().toISOString();

      // 通讯成功并拿到合法决策后才允许补充资金，通讯失败不会改变资金。
      await this.port.ensureCashFloor(agent.traderId, CASH_FLOOR_USD, CASH_TOP_UP_USD);
      const execution = await this.port.executeDecision(agent, persona, context, decision);
      const completion: LLMAgentRunCompletion = {
        completedAt: this.clock().toISOString(),
        nextActionAt: this.#nextNormalActionAt(),
        state: execution.state,
        modelId: this.config.modelId,
        decision,
        detail: execution.detail ?? null,
      };
      await this.port.completeAgentRun(agent, completion);
      return completion.state;
    } catch (error) {
      if (
        error instanceof LLMClientError ||
        error instanceof LLMDecisionValidationError
      ) {
        if (error instanceof LLMClientError && error.code === "ABORTED") {
          return "ERROR";
        }
        return this.#completeFailure(agent, error.message, true);
      }
      return this.#completeFailure(agent, safeErrorMessage(error), false);
    }
  }

  async #completeFailure(
    agent: LLMTraderAgent,
    detail: string,
    providerFailure: boolean,
  ): Promise<"ERROR"> {
    const now = this.clock();
    let nextActionAt: string;

    if (providerFailure) {
      this.#openCircuit(detail, now);
      nextActionAt = new Date(this.#circuitOpenUntilMs).toISOString();
    } else {
      nextActionAt = new Date(now.getTime() + this.config.circuitBackoffMs).toISOString();
    }
    this.#lastError = detail.slice(0, 500);

    try {
      await this.port.completeAgentRun(agent, {
        completedAt: now.toISOString(),
        nextActionAt,
        state: "ERROR",
        modelId: this.config.modelId,
        decision: null,
        detail: this.#lastError,
      });
    } catch {
      // 记录错误失败也不能向普通行情运行时传播。
    }
    return "ERROR";
  }

  #nextNormalActionAt(): string {
    const jitter = 0.85 + this.random() * 0.3;
    return new Date(
      this.clock().getTime() + Math.round(this.config.decisionIntervalMs * jitter),
    ).toISOString();
  }

  #openCircuit(detail: string, now: Date): void {
    this.#providerFailures += 1;
    const backoffMs = Math.min(
      this.config.circuitMaximumBackoffMs,
      this.config.circuitBackoffMs * 2 ** Math.min(8, this.#providerFailures - 1),
    );
    this.#circuitOpenUntilMs = now.getTime() + backoffMs;
    this.#lastError = detail.slice(0, 500);
  }
}

function emptyRound(circuitOpenUntil: string | null): LLMTradingRoundResult {
  return {
    dueAgents: 0,
    completedAgents: 0,
    executed: 0,
    pending: 0,
    held: 0,
    rejected: 0,
    errors: 0,
    circuitOpenUntil,
  };
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
