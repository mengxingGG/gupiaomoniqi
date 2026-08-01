import { z } from "zod";
import type { LLMTraderPersona } from "./LLMPersonas.js";

export const llmTradeDecisionSchema = z
  .object({
    action: z.enum(["BUY", "SELL", "HOLD"]),
    instrumentId: z.string().trim().min(1).max(200).nullable(),
    orderType: z.enum(["MARKET", "LIMIT"]).nullable(),
    limitPrice: z.number().finite().positive().nullable(),
    allocationPercent: z.number().finite().min(0).max(100),
    positionPercent: z.number().finite().min(0).max(100),
    confidence: z.number().finite().min(0).max(1),
    reason: z.string().trim().min(1).max(160),
  })
  .strict();

export type LLMTradeDecision = z.infer<typeof llmTradeDecisionSchema>;

export const LLM_TRADE_DECISION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "action",
    "instrumentId",
    "orderType",
    "limitPrice",
    "allocationPercent",
    "positionPercent",
    "confidence",
    "reason",
  ],
  properties: {
    action: { type: "string", enum: ["BUY", "SELL", "HOLD"] },
    instrumentId: { type: ["string", "null"] },
    orderType: { type: ["string", "null"], enum: ["MARKET", "LIMIT", null] },
    limitPrice: { type: ["number", "null"], exclusiveMinimum: 0 },
    allocationPercent: { type: "number", minimum: 0, maximum: 100 },
    positionPercent: { type: "number", minimum: 0, maximum: 100 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string", minLength: 1, maxLength: 160 },
  },
} as const;

export class LLMDecisionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMDecisionValidationError";
  }
}

export function parseLLMTradeDecision(
  value: unknown,
  allowedInstrumentIds: ReadonlySet<string>,
  persona: LLMTraderPersona,
): LLMTradeDecision {
  const result = llmTradeDecisionSchema.safeParse(value);
  if (!result.success) {
    throw new LLMDecisionValidationError(
      result.error.issues
        .slice(0, 4)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("；"),
    );
  }

  const decision = result.data;
  if (decision.action === "HOLD") {
    if (
      decision.instrumentId !== null ||
      decision.orderType !== null ||
      decision.limitPrice !== null ||
      decision.allocationPercent !== 0 ||
      decision.positionPercent !== 0
    ) {
      throw new LLMDecisionValidationError("HOLD 必须使用空标的、空订单类型和零比例");
    }
    return decision;
  }

  if (!decision.instrumentId || !allowedInstrumentIds.has(decision.instrumentId)) {
    throw new LLMDecisionValidationError("模型选择了候选集之外的股票");
  }
  if (!decision.orderType) {
    throw new LLMDecisionValidationError("买卖决策必须提供订单类型");
  }
  if (decision.orderType === "LIMIT" && decision.limitPrice === null) {
    throw new LLMDecisionValidationError("限价单必须提供限价");
  }
  if (decision.orderType === "MARKET" && decision.limitPrice !== null) {
    throw new LLMDecisionValidationError("市价单的限价必须为空");
  }

  if (decision.action === "BUY") {
    if (
      decision.allocationPercent <= 0 ||
      decision.allocationPercent > persona.maximumSingleTradePercent ||
      decision.positionPercent !== 0
    ) {
      throw new LLMDecisionValidationError("买入资金比例超出该智能体的风险边界");
    }
  } else if (
    decision.positionPercent <= 0 ||
    decision.allocationPercent !== 0
  ) {
    throw new LLMDecisionValidationError("卖出必须提供有效持仓比例且买入比例为零");
  }

  return decision;
}
