import type { Quote } from "@gupiaomoniqi/shared";
import type { VirtualMarketEngine } from "./VirtualMarketEngine.js";

export type QuoteListener = (quotes: Quote[]) => void;

export interface QuoteRecorder {
  recordQuotes(quotes: Quote[]): Promise<void>;
}

export class VirtualMarketRuntime {
  readonly #listeners = new Set<QuoteListener>();
  #timer: NodeJS.Timeout | null = null;
  #tickRunning = false;

  constructor(
    private readonly engine: VirtualMarketEngine,
    private readonly intervalMs: number,
    private readonly recorder?: QuoteRecorder,
  ) {}

  start(): void {
    if (this.#timer) {
      return;
    }

    this.#timer = setInterval(() => {
      void this.runTick().catch((error: unknown) => {
        console.error("虚拟行情 tick 失败", error);
      });
    }, this.intervalMs);
    this.#timer.unref();
  }

  stop(): void {
    if (!this.#timer) {
      return;
    }

    clearInterval(this.#timer);
    this.#timer = null;
  }

  async runTick(): Promise<Quote[]> {
    if (this.#tickRunning) {
      return [];
    }

    this.#tickRunning = true;

    try {
      const quotes = await this.engine.tick();
      await this.recorder?.recordQuotes(quotes);

      for (const listener of this.#listeners) {
        listener(quotes);
      }

      return quotes;
    } finally {
      this.#tickRunning = false;
    }
  }

  subscribe(listener: QuoteListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
