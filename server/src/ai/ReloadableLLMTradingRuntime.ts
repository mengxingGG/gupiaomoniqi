import type {
  LLMTradingConfig,
  RootConfigState,
} from "../config/RootConfig.js";
import { LLMTradingRuntime } from "./LLMTradingRuntime.js";
import {
  LLMTradingService,
  type LLMTradingServiceStatus,
} from "./LLMTradingService.js";

export interface LLMTradingComponents {
  service: LLMTradingService;
  runtime: LLMTradingRuntime;
}

export type LLMTradingComponentsFactory = (
  config: LLMTradingConfig,
) => LLMTradingComponents;

export class ReloadableLLMTradingRuntime {
  #service: LLMTradingService | null = null;
  #runtime: LLMTradingRuntime | null = null;
  #running = false;
  #configurationState: RootConfigState;
  #configurationError: string | null;
  #reloadState: RootConfigState | null = null;
  #reloadError: string | null = null;
  #reloadQueue: Promise<void> = Promise.resolve();

  constructor(
    initialConfig: LLMTradingConfig | null,
    initialState: RootConfigState,
    initialError: string | null,
    private readonly createComponents: LLMTradingComponentsFactory,
  ) {
    this.#configurationState = initialState;
    this.#configurationError = initialError;
    if (initialConfig) {
      const components = createComponents(initialConfig);
      this.#service = components.service;
      this.#runtime = components.runtime;
    }
  }

  get service(): LLMTradingService | null {
    return this.#service;
  }

  start(): void {
    if (this.#running) {
      return;
    }
    this.#running = true;
    this.#runtime?.start();
  }

  reload(
    config: LLMTradingConfig | null,
    state: RootConfigState,
    error: string | null,
  ): Promise<void> {
    const operation = this.#reloadQueue.then(() =>
      this.#replace(config, state, error),
    );
    this.#reloadQueue = operation.catch(() => undefined);
    return operation;
  }

  reportReloadFailure(state: RootConfigState, error: string | null): void {
    this.#reloadState = state;
    this.#reloadError =
      error ??
      (state === "MISSING"
        ? "配置文件暂时不存在，继续使用上一次有效 LLM 配置"
        : "LLM 配置热重载失败");
  }

  getStatus():
    | (LLMTradingServiceStatus & {
        configurationState: RootConfigState;
        reloadState: RootConfigState | null;
        reloadError: string | null;
      })
    | {
        enabled: false;
        configurationState: RootConfigState;
        error: string | null;
        reloadState: RootConfigState | null;
        reloadError: string | null;
      } {
    const reloadStatus = {
      reloadState: this.#reloadState,
      reloadError: this.#reloadError,
    };
    if (this.#service) {
      return {
        ...this.#service.getStatus(),
        configurationState: this.#configurationState,
        ...reloadStatus,
      };
    }
    return {
      enabled: false,
      configurationState: this.#configurationState,
      error: this.#configurationError,
      ...reloadStatus,
    };
  }

  async stopAndWait(): Promise<void> {
    this.#running = false;
    await this.#reloadQueue;
    await this.#runtime?.stopAndWait();
  }

  async #replace(
    config: LLMTradingConfig | null,
    state: RootConfigState,
    error: string | null,
  ): Promise<void> {
    const next = config ? this.createComponents(config) : null;
    const previousRuntime = this.#runtime;
    await previousRuntime?.stopAndWait();

    this.#service = next?.service ?? null;
    this.#runtime = next?.runtime ?? null;
    this.#configurationState = state;
    this.#configurationError = error;
    this.#reloadState = null;
    this.#reloadError = null;

    if (this.#running) {
      this.#runtime?.start();
    }
  }
}
