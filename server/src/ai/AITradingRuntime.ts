import type { AITradingService } from "./AITradingService.js";

interface AIRuntimeSettings {
  activePerRound: number;
  intervalMs: number;
}

export class AITradingRuntime {
  #timer: NodeJS.Timeout | null = null;
  #roundRunning = false;
  #running = false;

  constructor(
    private readonly service: AITradingService,
    private readonly intervalMs: number,
    private readonly activePerRound: number,
    private readonly settingsSource?: () => AIRuntimeSettings,
  ) {}

  start(): void {
    if (this.#timer || this.#running) {
      return;
    }

    this.#running = true;
    this.#schedule(this.#currentSettings().intervalMs);
  }

  stop(): void {
    this.#running = false;
    if (!this.#timer) {
      return;
    }

    clearTimeout(this.#timer);
    this.#timer = null;
  }

  async runRound() {
    if (this.#roundRunning) {
      return null;
    }

    this.#roundRunning = true;

    try {
      const settings = this.#currentSettings();
      return await this.service.runRound(settings.activePerRound);
    } catch (error) {
      console.error("AI 交易轮执行失败", error);
      return null;
    } finally {
      this.#roundRunning = false;
    }
  }

  #schedule(delayMs: number): void {
    this.#timer = setTimeout(async () => {
      this.#timer = null;
      if (!this.#running) {
        return;
      }
      await this.runRound();
      if (this.#running && this.#timer === null) {
        this.#schedule(this.#currentSettings().intervalMs);
      }
    }, delayMs);
    this.#timer.unref();
  }

  #currentSettings(): AIRuntimeSettings {
    const dynamic = this.settingsSource?.();
    return {
      activePerRound: normalizedInteger(
        dynamic?.activePerRound,
        this.activePerRound,
        1,
      ),
      intervalMs: normalizedInteger(
        dynamic?.intervalMs,
        this.intervalMs,
        100,
      ),
    };
  }
}

function normalizedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
): number {
  const candidate = Number.isFinite(value)
    ? value!
    : Number.isFinite(fallback)
      ? fallback
      : minimum;

  return Math.max(minimum, Math.round(candidate));
}
