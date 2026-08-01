import { describe, expect, it } from "vitest";
import { LLMTradingRuntime } from "../src/ai/LLMTradingRuntime.js";
import type {
  LLMTradingRoundResult,
  LLMTradingService,
} from "../src/ai/LLMTradingService.js";

describe("LLMTradingRuntime", () => {
  it("拒绝重叠轮次且停止时取消并等待在途请求", async () => {
    let release!: () => void;
    let receivedSignal: AbortSignal | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = {
      runDue: async (signal?: AbortSignal): Promise<LLMTradingRoundResult> => {
        receivedSignal = signal;
        await pending;
        return emptyRound();
      },
    } as unknown as LLMTradingService;
    const runtime = new LLMTradingRuntime(service);

    const first = runtime.runOnce();
    await Promise.resolve();
    expect(await runtime.runOnce()).toBeNull();
    let stopped = false;
    const stopping = runtime.stopAndWait().then(() => {
      stopped = true;
    });
    expect(receivedSignal?.aborted).toBe(true);
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(stopped).toBe(true);
    await expect(first).resolves.toEqual(emptyRound());
  });
});

function emptyRound(): LLMTradingRoundResult {
  return {
    dueAgents: 0,
    completedAgents: 0,
    executed: 0,
    pending: 0,
    held: 0,
    rejected: 0,
    errors: 0,
    circuitOpenUntil: null,
  };
}
