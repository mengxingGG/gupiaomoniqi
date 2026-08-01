import type {
  LLMTradingRoundResult,
  LLMTradingService,
} from "./LLMTradingService.js";

export class LLMTradingRuntime {
  #timer: NodeJS.Timeout | null = null;
  #running = false;
  #roundController: AbortController | null = null;
  #roundPromise: Promise<LLMTradingRoundResult | null> | null = null;

  constructor(
    private readonly service: LLMTradingService,
    private readonly pollIntervalMs = 1_000,
    private readonly logError: (message: string, error: unknown) => void =
      (message, error) => console.error(message, error),
  ) {}

  start(): void {
    if (this.#running) {
      return;
    }
    this.#running = true;
    this.#schedule(0);
  }

  stop(): void {
    this.#running = false;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#roundController?.abort(new Error("LLM_RUNTIME_STOPPED"));
  }

  async stopAndWait(): Promise<void> {
    this.stop();
    const round = this.#roundPromise;
    if (round) {
      await round;
    }
  }

  runOnce(): Promise<LLMTradingRoundResult | null> {
    if (this.#roundPromise) {
      return Promise.resolve(null);
    }
    const controller = new AbortController();
    this.#roundController = controller;

    const round = (async () => {
      try {
        return await this.service.runDue(controller.signal);
      } catch (error) {
        this.logError("LLM 智能交易轮执行失败", error);
        return null;
      } finally {
        if (this.#roundController === controller) {
          this.#roundController = null;
        }
        this.#roundPromise = null;
      }
    })();
    this.#roundPromise = round;
    return round;
  }

  #schedule(delayMs: number): void {
    this.#timer = setTimeout(async () => {
      this.#timer = null;
      if (!this.#running) {
        return;
      }
      await this.runOnce();
      if (this.#running && !this.#timer) {
        this.#schedule(Math.max(250, this.pollIntervalMs));
      }
    }, Math.max(0, delayMs));
    this.#timer.unref();
  }
}
