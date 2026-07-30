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
    this.#schedule(0);
  }

  stop(): void {
    this.#running = false;
    if (!this.#timer) {
      return;
    }

    clearInterval(this.#timer);
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
      activePerRound: Math.max(
        1,
        Math.round(dynamic?.activePerRound ?? this.activePerRound),
      ),
      intervalMs: Math.max(
        100,
        Math.round(dynamic?.intervalMs ?? this.intervalMs),
      ),
    };
  }
}
