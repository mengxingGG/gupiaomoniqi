import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getHeapStatistics } from "node:v8";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import type {
  AITraderRankingItem,
  AITradingStatus,
  ApiEnvelope,
  ApiError,
  AuthResult,
  ChartRange,
  ChartSeries,
  DailyCheckInStatus,
  DisplayCurrency,
  EmailVerificationRequestResult,
  IndustrySummary,
  Instrument,
  MarketItem,
  MarketMode,
  MarketSocketMessage,
  LimitOrder,
  OrderCancellationResult,
  OrderSubmissionResult,
  OrderBookSnapshot,
  PaginatedData,
  PortfolioSnapshot,
  PasswordResetConfirmResult,
  PasswordResetRequestResult,
  PublicAccount,
  Quote,
  RealMarketStatus,
  RegistrationEmailVerificationConfirmResult,
  RewardClaimResult,
  StockMarket,
  TradeRequest,
  TradeResult,
  Transaction,
  WatchlistState,
} from "@gupiaomoniqi/shared";
import { UNKNOWN_INDUSTRY } from "@gupiaomoniqi/shared";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { z } from "zod";
import { AITradingRuntime } from "./ai/AITradingRuntime.js";
import { AITradingService } from "./ai/AITradingService.js";
import { LlamaCppTradingClient } from "./ai/LLMTradingClient.js";
import { LLMTradingRuntime } from "./ai/LLMTradingRuntime.js";
import { LLMTradingService } from "./ai/LLMTradingService.js";
import { ReloadableLLMTradingRuntime } from "./ai/ReloadableLLMTradingRuntime.js";
import { RepositoryLLMTradingPort } from "./ai/RepositoryLLMTradingPort.js";
import { AppUpdateService } from "./app-update/AppUpdateService.js";
import { registerAppUpdateRoutes } from "./app-update/registerAppUpdateRoutes.js";
import {
  GAME_RULES,
  LOAD_CONTROLLER_CONFIG,
  REAL_MARKET_CONFIG,
  SECURITY_CONFIG,
} from "./config.js";
import {
  loadRootConfig,
  resolveRootConfigPath,
} from "./config/RootConfig.js";
import {
  startRootConfigWatcher,
  type RootConfigWatcher,
} from "./config/RootConfigWatcher.js";
import type { DatabaseConnection } from "./db/client.js";
import { openDatabase } from "./db/client.js";
import { migrateDatabase } from "./db/migrations.js";
import { EastmoneyProvider } from "./real-market/EastmoneyProvider.js";
import {
  openRealDatabase,
  type RealDatabaseConnection,
} from "./real-market/db/client.js";
import { migrateRealDatabase } from "./real-market/db/migrations.js";
import { RealMarketDetailService } from "./real-market/RealMarketDetailService.js";
import { RealMarketRepository } from "./real-market/RealMarketRepository.js";
import { RealMarketRuntime } from "./real-market/RealMarketRuntime.js";
import {
  RealTradeError,
  RealTradingService,
} from "./real-market/RealTradingService.js";
import { DatabaseGameRepository } from "./repositories/DatabaseGameRepository.js";
import type {
  AccountRecord,
  GameRepository,
} from "./repositories/GameRepository.js";
import {
  AuthError,
  AuthService,
  toPublicAccount,
} from "./services/AuthService.js";
import { PortfolioService } from "./services/PortfolioService.js";
import { CandleService } from "./services/CandleService.js";
import { MarketDetailService } from "./services/MarketDetailService.js";
import { TradeError, TradeService } from "./services/TradeService.js";
import {
  AccountFeatureError,
  DatabaseAccountFeatureStore,
  MemoryAccountFeatureStore,
  WATCHLIST_LIMIT,
  type AccountFeatureStore,
} from "./services/AccountFeatureStore.js";
import { RewardService } from "./services/RewardService.js";
import {
  createPasswordResetMailerFromConfig,
  createPasswordResetMailerFromEnvironment,
  type PasswordResetMailer,
} from "./services/PasswordResetMailer.js";
import { runStorageMaintenance } from "./runtime/StorageMaintenance.js";
import type { PGlite } from "@electric-sql/pglite";
import { SystemLoadController } from "./runtime/SystemLoadController.js";
import { ensureVirtualMarketUniverse } from "./startup/marketSeedBootstrap.js";
import { VirtualMarketEngine } from "./virtual-market/VirtualMarketEngine.js";
import { VirtualMarketRuntime } from "./virtual-market/VirtualMarketRuntime.js";
import { MarketStateService } from "./virtual-market/MarketStateService.js";
import {
  DatabaseVirtualMarketStateStore,
  MemoryVirtualMarketStateStore,
} from "./virtual-market/MarketStateStore.js";

const tradeSchema = z.object({
  instrumentId: z.string().trim().min(1),
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number().int().positive(),
  orderMode: z.enum(["MARKET", "LIMIT"]).optional(),
  idempotencyKey: z.string().trim().min(8).max(100).optional(),
  mode: z.enum(["VIRTUAL", "REAL"]).default("VIRTUAL"),
});

const orderSchema = z
  .object({
    instrumentId: z.string().trim().min(1),
    side: z.enum(["BUY", "SELL"]),
    quantity: z.number().int().positive(),
    orderMode: z.enum(["MARKET", "LIMIT"]).default("MARKET"),
    limitPrice: z.number().positive().finite().optional(),
    idempotencyKey: z.string().trim().min(8).max(100).optional(),
    mode: z.enum(["VIRTUAL", "REAL"]).default("VIRTUAL"),
  })
  .superRefine((value, context) => {
    if (value.orderMode === "LIMIT" && value.limitPrice === undefined) {
      context.addIssue({
        code: "custom",
        path: ["limitPrice"],
        message: "限价单必须填写限价",
      });
    }
    if (value.orderMode === "MARKET" && value.limitPrice !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["limitPrice"],
        message: "市价单不能填写限价",
      });
    }
  });

const orderListSchema = z.object({
  mode: z.enum(["VIRTUAL", "REAL"]).default("VIRTUAL"),
  status: z.enum(["OPEN", "FILLED", "CANCELLED"]).optional(),
});

const strongPasswordSchema = z
  .string()
  .min(8, "密码至少 8 位")
  .max(128, "密码最多 128 位")
  .regex(/[a-z]/, "密码必须包含小写字母")
  .regex(/[A-Z]/, "密码必须包含大写字母")
  .regex(/[0-9]/, "密码必须包含数字");

const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "用户名至少 3 位")
    .max(20, "用户名最多 20 位")
    .regex(/^[A-Za-z0-9_]+$/, "用户名只能包含字母、数字和下划线"),
  email: z.string().trim().email("请输入有效邮箱").max(254),
  emailVerificationToken: z.string().uuid("邮箱验证凭证无效").optional(),
  password: strongPasswordSchema,
  displayName: z
    .string()
    .trim()
    .min(1, "请输入显示名称")
    .max(50, "显示名称最多 50 个字符"),
});

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1).max(128),
});

const currencySchema = z.object({
  currency: z.enum(["CNY", "USD"]),
});

const listingSchema = z.object({
  market: z.enum(["CN", "HK", "US", "UK"]).optional(),
  industry: z.string().trim().min(1).max(80).optional(),
  search: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(300).default(50),
  mode: z.enum(["VIRTUAL", "REAL"]).default("VIRTUAL"),
  sortBy: z
    .enum(["DEFAULT", "CHANGE_PERCENT"])
    .default("DEFAULT"),
  sortOrder: z.enum(["DESC", "ASC"]).default("DESC"),
  watchlist: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

const passwordResetRequestSchema = z.object({
  email: z.string().trim().email("请输入有效邮箱").max(254),
});

const passwordResetConfirmSchema = z.object({
  email: z.string().trim().email("请输入有效邮箱").max(254),
  code: z.string().regex(/^\d{6}$/, "请输入 6 位数字验证码"),
  newPassword: strongPasswordSchema,
});

const emailVerificationRequestSchema = z.object({
  email: z.string().trim().email("请输入有效邮箱").max(254),
  purpose: z
    .enum(["ACCOUNT_BINDING", "REGISTRATION"])
    .default("ACCOUNT_BINDING"),
});

const emailVerificationConfirmSchema = z.object({
  email: z.string().trim().email("请输入有效邮箱").max(254),
  code: z.string().regex(/^\d{6}$/, "请输入 6 位数字验证码"),
  purpose: z
    .enum(["ACCOUNT_BINDING", "REGISTRATION"])
    .default("ACCOUNT_BINDING"),
});

const industryDirectorySchema = z.object({
  market: z.enum(["CN", "HK", "US", "UK"]).optional(),
  mode: z.enum(["VIRTUAL", "REAL"]).default("VIRTUAL"),
});

const chartSchema = z.object({
  range: z
    .enum(["INTRADAY", "DAY", "MONTH", "YEAR"])
    .default("INTRADAY"),
  mode: z.enum(["VIRTUAL", "REAL"]).default("VIRTUAL"),
});

const modeSchema = z.object({
  mode: z.enum(["VIRTUAL", "REAL"]).default("VIRTUAL"),
});

const watchlistMutationSchema = z.object({
  mode: z.enum(["VIRTUAL", "REAL"]),
  instrumentId: z.string().trim().min(1).max(200),
});

const checkInSchema = z.object({
  mode: z.enum(["VIRTUAL", "REAL"]),
});

const giftCodeSchema = z.object({
  mode: z.enum(["VIRTUAL", "REAL"]),
  code: z.string().trim().min(1).max(100),
  idempotencyKey: z.string().trim().min(8).max(100),
});

const rankingSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export interface ApplicationContext {
  app: FastifyInstance;
  repository: GameRepository;
  runtime: VirtualMarketRuntime;
  aiRuntime: AITradingRuntime;
  aiTradingService: AITradingService;
  llmTradingRuntime: ReloadableLLMTradingRuntime;
  llmTradingService: LLMTradingService | null;
  authService: AuthService;
  candleService: CandleService;
  marketDetailService: MarketDetailService;
  portfolioService: PortfolioService;
  tradeService: TradeService;
  realRepository: RealMarketRepository;
  realRuntime: RealMarketRuntime;
  realMarketDetailService: RealMarketDetailService;
  realTradingService: RealTradingService;
  accountFeatureStore: AccountFeatureStore;
  rewardService: RewardService;
  loadController: SystemLoadController;
  marketStateService: MarketStateService;
}

export interface CreateApplicationOptions {
  repository?: GameRepository;
  databaseConnection?: DatabaseConnection;
  logger?: boolean;
  serveWeb?: boolean;
  webRoot?: string;
  random?: () => number;
  clock?: () => Date;
  tickIntervalMs?: number;
  aiEnabled?: boolean;
  aiTraderCount?: number;
  aiActivePerRound?: number;
  aiRoundIntervalMs?: number;
  realDatabaseConnection?: RealDatabaseConnection;
  realRepository?: RealMarketRepository;
  realSyncEnabled?: boolean;
  realFetchImplementation?: typeof fetch;
  virtualMarketEventsEnabled?: boolean;
  appUpdateDirectory?: string;
  rootConfigPath?: string;
  rootConfigWatchEnabled?: boolean;
  rootConfigWatchIntervalMs?: number;
  rootConfigWatchDebounceMs?: number;
  llmFetchImplementation?: typeof fetch;
  passwordResetMailer?: PasswordResetMailer | null;
  registrationEmailVerificationRequired?: boolean;
}

export async function createApplication(
  options: CreateApplicationOptions = {},
): Promise<ApplicationContext> {
  const staticWeb = await resolveStaticWebConfiguration(options);
  const startupStartedAt = Date.now();
  const startupLog = (message: string): void => {
    if (!options.logger) {
      return;
    }
    const elapsedMs = Date.now() - startupStartedAt;
    console.error(`[startup +${elapsedMs}ms] ${message}`);
  };
  let ownedConnection: DatabaseConnection | undefined;
  let ownedRealConnection: RealDatabaseConnection | undefined;
  let repository = options.repository;
  let primaryConnection = options.databaseConnection;
  const clock = options.clock ?? (() => new Date());
  const rootConfigPath = resolveRootConfigPath(options.rootConfigPath);
  const rootConfig = await loadRootConfig({ path: rootConfigPath });
  if (rootConfig.state === "INVALID") {
    console.warn(`LLM 智能交易配置无效，已安全停用：${rootConfig.error}`);
  }
  if (rootConfig.smtpState === "INVALID") {
    console.warn(`SMTP 配置无效，邮件发送已安全停用：${rootConfig.smtpError}`);
  }

  if (!repository) {
    startupLog("opening virtual database");
    const connection = primaryConnection ?? (await openDatabase());
    primaryConnection = connection;
    startupLog("migrating virtual database");
    await migrateDatabase(connection.client);
    if (!options.databaseConnection) {
      startupLog("checking virtual market universe");
      const bootstrap = await ensureVirtualMarketUniverse(connection, {
        log: startupLog,
      });
      startupLog(
        `virtual market universe ${bootstrap.status}: ${bootstrap.instrumentCount} instruments`,
      );
    }
    startupLog("running virtual storage maintenance");
    await runStorageMaintenance({
      virtualClient: connection.client,
      now: clock(),
    });
    startupLog("loading virtual repository");
    repository = await DatabaseGameRepository.create(connection);
    startupLog("virtual repository ready");

    if (!options.databaseConnection) {
      ownedConnection = connection;
    }
  }

  let realRepository = options.realRepository;
  if (!realRepository) {
    startupLog("opening real database");
    const realConnection =
      options.realDatabaseConnection ??
      (await openRealDatabase(
        options.repository || options.databaseConnection
          ? ":memory:"
          : undefined,
      ));
    startupLog("migrating real database");
    await migrateRealDatabase(realConnection.client);
    startupLog("running real storage maintenance");
    await runStorageMaintenance({
      realClient: realConnection.client,
      now: clock(),
    });
    startupLog("loading real repository");
    realRepository = await RealMarketRepository.create(
      realConnection.client,
    );
    startupLog("real repository ready");
    if (!options.realDatabaseConnection) {
      ownedRealConnection = realConnection;
    }
  }
  const accountFeatureStore: AccountFeatureStore = primaryConnection
    ? new DatabaseAccountFeatureStore(primaryConnection.client)
    : new MemoryAccountFeatureStore();
  const realSyncEnabled =
    options.realSyncEnabled ??
    (!options.repository &&
      !options.databaseConnection &&
      REAL_MARKET_CONFIG.enabled);
  const realRuntimeConfig = {
    ...REAL_MARKET_CONFIG,
    enabled: realSyncEnabled,
  };
  const realProvider = new EastmoneyProvider({
    pageSize: realRuntimeConfig.pageSize,
    requestTimeoutMs: realRuntimeConfig.requestTimeoutMs,
    fetchImplementation: options.realFetchImplementation,
    clock,
  });
  const realTradingService = new RealTradingService(
    realRepository,
    realRuntimeConfig.quoteMaximumReceiveAgeMs,
    clock,
  );
  let loadController: SystemLoadController | null = null;
  const realRuntime = new RealMarketRuntime(
    realRepository,
    realProvider,
    realRuntimeConfig,
    async () => {
      const priorities = await accountFeatureStore.realWatchlistPriorities();
      const openOrderInstrumentIds =
        await realTradingService.listOpenOrderInstrumentIds();
      for (const instrumentId of openOrderInstrumentIds) {
        priorities.set(
          instrumentId,
          Math.max(priorities.get(instrumentId) ?? 0, 25_000),
        );
      }
      return priorities;
    },
    clock,
    () =>
      loadController?.getRealMarketSettings() ?? {
        concurrency: realRuntimeConfig.concurrency,
        hotRefreshIntervalMs: realRuntimeConfig.hotRefreshIntervalMs,
        hotPagesPerRound: realRuntimeConfig.hotPagesPerRound,
        fullSweepTargetMs: realRuntimeConfig.fullSweepTargetMs,
      },
  );
  startupLog("initializing real runtime");
  await realRuntime.initialize();
  startupLog("real runtime ready");

  startupLog("initializing virtual engine");
  const marketStateService = new MarketStateService(
    repository,
    repository.listInstruments(),
    primaryConnection
      ? new DatabaseVirtualMarketStateStore(primaryConnection.client)
      : new MemoryVirtualMarketStateStore(),
    options.random,
    clock,
    options.virtualMarketEventsEnabled ??
      process.env.VIRTUAL_MARKET_EVENTS_ENABLED !== "false",
  );
  const engine = new VirtualMarketEngine(
    repository,
    repository.listInstruments(),
    options.random,
    clock,
    marketStateService,
  );
  await engine.initialize();
  startupLog("virtual engine ready");
  const candleService = new CandleService(repository);
  startupLog("initializing candle service");
  await candleService.initialize();
  startupLog("candle service ready");

  const runtime = new VirtualMarketRuntime(
    engine,
    options.tickIntervalMs ?? GAME_RULES.tickIntervalMs,
    candleService,
  );
  const passwordResetMailer =
    options.passwordResetMailer === undefined
      ? createPasswordResetMailerFromEnvironment() ??
        (rootConfig.smtp
          ? createPasswordResetMailerFromConfig(rootConfig.smtp)
          : null)
      : options.passwordResetMailer;
  const authService = new AuthService(
    repository,
    clock,
    passwordResetMailer,
  );
  const registrationEmailVerificationRequired =
    options.registrationEmailVerificationRequired ??
    (process.env.NODE_ENV === "production" || passwordResetMailer !== null);
  const marketDetailService = new MarketDetailService(
    repository,
    engine,
    candleService,
  );
  const portfolioService = new PortfolioService(repository);
  const tradeService = new TradeService(
    repository,
    portfolioService,
    clock,
    engine,
  );
  const llmTradingPort = new RepositoryLLMTradingPort(
    repository,
    tradeService,
    engine,
    clock,
  );
  const llmTradingRuntime = new ReloadableLLMTradingRuntime(
    rootConfig.llmTrading,
    rootConfig.state,
    rootConfig.error,
    (config) => {
      const service = new LLMTradingService(
        config,
        new LlamaCppTradingClient(config, options.llmFetchImplementation),
        llmTradingPort,
        clock,
        options.random,
      );
      return {
        service,
        runtime: new LLMTradingRuntime(service),
      };
    },
  );
  const aiEnabled =
    options.aiEnabled ??
    (!options.repository &&
      !options.databaseConnection &&
      process.env.AI_TRADING_ENABLED !== "false");
  const aiTradingService = new AITradingService(
    repository,
    tradeService,
    options.random,
    clock,
    aiEnabled,
    engine,
  );
  await aiTradingService.ensurePopulation(
    options.aiTraderCount ?? GAME_RULES.aiTraderCount,
  );
  const aiRuntime = new AITradingRuntime(
    aiTradingService,
    options.aiRoundIntervalMs ?? GAME_RULES.aiRoundIntervalMs,
    options.aiActivePerRound ?? GAME_RULES.aiActivePerRound,
    () =>
      loadController?.getAiSettings() ?? {
        activePerRound:
          options.aiActivePerRound ?? GAME_RULES.aiActivePerRound,
        intervalMs:
          options.aiRoundIntervalMs ?? GAME_RULES.aiRoundIntervalMs,
      },
  );
  loadController = new SystemLoadController(
    {
      aiStatus: () => aiTradingService.getStatus(),
      realStatus: () => realRuntime.getStatus(),
    },
    {
      aiActivePerRound:
        options.aiActivePerRound ?? GAME_RULES.aiActivePerRound,
      aiRoundIntervalMs:
        options.aiRoundIntervalMs ?? GAME_RULES.aiRoundIntervalMs,
      realConcurrency: realRuntimeConfig.concurrency,
      realHotRefreshIntervalMs: realRuntimeConfig.hotRefreshIntervalMs,
      realHotPagesPerRound: realRuntimeConfig.hotPagesPerRound,
      realFullSweepTargetMs: realRuntimeConfig.fullSweepTargetMs,
    },
    {
      enabled: LOAD_CONTROLLER_CONFIG.enabled,
      sampleIntervalMs: LOAD_CONTROLLER_CONFIG.sampleIntervalMs,
      reliefSamples: LOAD_CONTROLLER_CONFIG.reliefSamples,
    },
  );
  const realMarketDetailService = new RealMarketDetailService(
    realRepository,
    realRuntime,
  );
  const rewardService = new RewardService(
    accountFeatureStore,
    repository,
    portfolioService,
    realTradingService,
    clock,
  );
  const unsubscribeVirtualOrderMatcher = runtime.subscribe((quotes) => {
    void tradeService
      .matchOpenOrders(quotes.map((quote) => quote.instrumentId))
      .catch((error: unknown) => {
        console.error("虚拟限价单撮合失败", error);
      });
  });
  const unsubscribeRealOrderMatcher = realRuntime.subscribe((quotes) => {
    void realTradingService
      .matchOpenOrders(quotes.map((quote) => quote.instrumentId))
      .catch((error: unknown) => {
        console.error("真实行情限价单撮合失败", error);
      });
  });
  await tradeService.matchOpenOrders();
  await realTradingService.matchOpenOrders();
  // Periodic storage maintenance
  const virtualClient: PGlite | undefined = primaryConnection?.client;
  const realClient: PGlite | undefined = ownedRealConnection?.client;

  const MAINTENANCE_QUICK_MS = 60 * 60 * 1000;
  const MAINTENANCE_DEEP_MS = 4 * 60 * 60 * 1000;
  let quickTimer: ReturnType<typeof setInterval> | null = null;
  let deepTimer: ReturnType<typeof setInterval> | null = null;
  let rootConfigWatcher: RootConfigWatcher | null = null;

  async function runQuickMaintenance() {
    try {
      const result = await runStorageMaintenance({
        virtualClient,
        realClient,
        now: clock(),
        deep: false,
      });
      if ((result.virtual?.deletedOldMinuteCandles ?? 0) > 0) {
        startupLog(`maintenance: deleted ${result.virtual?.deletedOldMinuteCandles} old minute candles`);
      }
    } catch (err: any) {
      startupLog(`maintenance quick failed: ${err?.message ?? err}`);
    }
  }

  async function runDeepMaintenance() {
    try {
      startupLog("maintenance: starting deep compaction (VACUUM FULL)...");
      const result = await runStorageMaintenance({
        virtualClient,
        realClient,
        now: clock(),
        deep: true,
      });
      startupLog(`maintenance deep: virtual vacuumed=${result.virtual?.vacuumed}, real vacuumed=${result.real?.vacuumed}`);
    } catch (err: any) {
      startupLog(`maintenance deep failed: ${err?.message ?? err}`);
    }
  }

  quickTimer = setInterval(runQuickMaintenance, MAINTENANCE_QUICK_MS);
  quickTimer.unref();
  deepTimer = setInterval(runDeepMaintenance, MAINTENANCE_DEEP_MS);
  deepTimer.unref();

  const authLimiter = new WindowRateLimiter();
  const app = Fastify({
    logger: options.logger ?? false,
  });
  if (options.rootConfigWatchEnabled ?? true) {
    rootConfigWatcher = startRootConfigWatcher({
      path: rootConfigPath,
      intervalMs: options.rootConfigWatchIntervalMs,
      debounceMs: options.rootConfigWatchDebounceMs,
      onChange: async () => {
        const nextRootConfig = await loadRootConfig({ path: rootConfigPath });
        if (
          nextRootConfig.state === "INVALID" ||
          nextRootConfig.state === "MISSING"
        ) {
          llmTradingRuntime.reportReloadFailure(
            nextRootConfig.state,
            nextRootConfig.error,
          );
          app.log.warn(
            {
              path: rootConfigPath,
              state: nextRootConfig.state,
              error: nextRootConfig.error,
            },
            "LLM config hot reload skipped; keeping the last valid configuration",
          );
          return;
        }

        await llmTradingRuntime.reload(
          nextRootConfig.llmTrading,
          nextRootConfig.state,
          nextRootConfig.error,
        );
        app.log.info(
          {
            path: rootConfigPath,
            state: nextRootConfig.state,
            modelId: nextRootConfig.llmTrading?.modelId ?? null,
            jsonSchemaMode:
              nextRootConfig.llmTrading?.jsonSchemaMode ?? null,
          },
          "LLM config hot reload completed",
        );
      },
      onError: (error) => {
        llmTradingRuntime.reportReloadFailure(
          "INVALID",
          error instanceof Error ? error.message : String(error),
        );
        app.log.error(error, "LLM config hot reload failed");
      },
    });
  }
  const appUpdateService = new AppUpdateService(
    options.appUpdateDirectory ??
      process.env.APP_UPDATE_DIR ??
      join("server", "data", "app-updates"),
  );

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(
        null,
        SECURITY_CONFIG.allowedOrigins.includes(origin),
      );
    },
  });
  await app.register(websocket);

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header(
      "Content-Security-Policy",
      staticWeb &&
        !hasUnsafeStaticPath(request.url) &&
        !isServicePath(request.url)
        ? [
            "default-src 'self'",
            "base-uri 'self'",
            "frame-ancestors 'none'",
            "form-action 'self'",
            "object-src 'none'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            "font-src 'self' data:",
            "connect-src 'self' ws: wss:",
          ].join("; ")
        : "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    reply.header("Cross-Origin-Resource-Policy", "same-origin");
    reply.header("Cross-Origin-Opener-Policy", "same-origin");
    return payload;
  });

  registerAppUpdateRoutes(app, appUpdateService);

  app.get("/api/health", async () => ({
    data: {
      status: "ok",
      mode: "VIRTUAL",
      database: "PGLITE",
      instrumentCount: repository.listInstruments().length,
      tickIntervalMs: options.tickIntervalMs ?? GAME_RULES.tickIntervalMs,
      accountModel: "SINGLE_USD_LEDGER",
      usdCnyRate: GAME_RULES.usdCnyDisplayRate,
      aiTrading: aiTradingService.getStatus(),
      llmTrading: llmTradingRuntime.getStatus(),
      chartSource: "DATABASE_RECORDED",
      realMarket: realRuntime.getStatus(),
      loadControl: loadController.getStatus(),
      runtimeMemory: runtimeMemoryStatus(),
      virtualMarketState: marketStateService.getStatus(),
      emailDelivery: {
        configured: passwordResetMailer !== null,
        mode: "SMTP_SEND_ONLY",
        registrationVerificationRequired:
          registrationEmailVerificationRequired,
      },
      serverTime: new Date().toISOString(),
    },
  }));

  app.post<{
    Body: z.infer<typeof registerSchema>;
    Reply: ApiEnvelope<AuthResult> | ApiError;
  }>("/api/auth/register", async (request, reply) => {
    if (!authLimiter.allow(`register:${request.ip}`, 5, 60_000)) {
      return reply.status(429).send({
        code: "RATE_LIMITED",
        message: "注册尝试过于频繁，请稍后再试",
      });
    }

    const parsed = registerSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REGISTRATION",
        message:
          parsed.error.issues[0]?.message ?? "注册信息格式无效",
      });
    }
    if (
      registrationEmailVerificationRequired &&
      !parsed.data.emailVerificationToken
    ) {
      return reply.status(400).send({
        code: "EMAIL_VERIFICATION_REQUIRED",
        message: "请先完成注册邮箱验证码校验",
      });
    }

    try {
      return reply.status(201).send({
        data: await authService.register(parsed.data),
      });
    } catch (error) {
      return sendAuthError(error, reply);
    }
  });

  app.post<{
    Body: z.infer<typeof loginSchema>;
    Reply: ApiEnvelope<AuthResult> | ApiError;
  }>("/api/auth/login", async (request, reply) => {
    if (!authLimiter.allow(`login:${request.ip}`, 10, 60_000)) {
      return reply.status(429).send({
        code: "RATE_LIMITED",
        message: "登录尝试过于频繁，请稍后再试",
      });
    }

    const parsed = loginSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_LOGIN",
        message: "请输入用户名和密码",
      });
    }

    try {
      return {
        data: await authService.login(parsed.data),
      };
    } catch (error) {
      return sendAuthError(error, reply);
    }
  });

  app.post<{
    Body: z.infer<typeof passwordResetRequestSchema>;
    Reply: ApiEnvelope<PasswordResetRequestResult> | ApiError;
  }>("/api/auth/password-reset/request", async (request, reply) => {
    const parsed = passwordResetRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_PASSWORD_RESET_REQUEST",
        message: parsed.error.issues[0]?.message ?? "邮箱格式无效",
      });
    }
    const emailKey = parsed.data.email.toLowerCase();
    if (
      !authLimiter.allow("password-reset-global", 60, 60_000) ||
      !authLimiter.allow(`password-reset-ip:${request.ip}`, 8, 15 * 60_000) ||
      !authLimiter.allow(`password-reset-email:${emailKey}`, 3, 15 * 60_000)
    ) {
      return reply.status(429).send({
        code: "RATE_LIMITED",
        message: "验证码请求过于频繁，请稍后再试",
      });
    }

    try {
      return reply.status(202).send({
        data: await authService.requestPasswordReset(parsed.data),
      });
    } catch (error) {
      return sendAuthError(error, reply);
    }
  });

  app.post<{
    Body: z.infer<typeof passwordResetConfirmSchema>;
    Reply: ApiEnvelope<PasswordResetConfirmResult> | ApiError;
  }>("/api/auth/password-reset/confirm", async (request, reply) => {
    if (
      !authLimiter.allow(
        `password-reset-confirm:${request.ip}`,
        12,
        15 * 60_000,
      )
    ) {
      return reply.status(429).send({
        code: "RATE_LIMITED",
        message: "验证码尝试过于频繁，请稍后再试",
      });
    }
    const parsed = passwordResetConfirmSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_PASSWORD_RESET_CONFIRMATION",
        message:
          parsed.error.issues[0]?.message ?? "密码找回信息格式无效",
      });
    }

    try {
      return {
        data: await authService.confirmPasswordReset(parsed.data),
      };
    } catch (error) {
      return sendAuthError(error, reply);
    }
  });

  app.get<{
    Reply: ApiEnvelope<PublicAccount> | ApiError;
  }>("/api/auth/me", async (request, reply) => {
    const account = requireAccount(request, authService);

    if (!account) {
      return unauthorized(reply);
    }

    return {
      data: toPublicAccount(account),
    };
  });

  app.post<{
    Body: z.infer<typeof emailVerificationRequestSchema>;
    Reply: ApiEnvelope<EmailVerificationRequestResult> | ApiError;
  }>("/api/account/email-verification/request", async (request, reply) => {
    const parsed = emailVerificationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_EMAIL_VERIFICATION_REQUEST",
        message: parsed.error.issues[0]?.message ?? "邮箱格式无效",
      });
    }
    const emailKey = parsed.data.email.toLowerCase();
    if (parsed.data.purpose === "REGISTRATION") {
      if (
        !authLimiter.allow("registration-email-global", 60, 60_000) ||
        !authLimiter.allow(
          `registration-email:${emailKey}`,
          3,
          15 * 60_000,
        ) ||
        !authLimiter.allow(
          `registration-email-ip:${request.ip}`,
          8,
          15 * 60_000,
        )
      ) {
        return reply.status(429).send({
          code: "RATE_LIMITED",
          message: "验证码请求过于频繁，请稍后再试",
        });
      }
      try {
        return reply.status(202).send({
          data: await authService.requestRegistrationEmailVerification(
            parsed.data,
          ),
        });
      } catch (error) {
        return sendAuthError(error, reply);
      }
    }

    const account = requireAccount(request, authService);
    if (!account) {
      return unauthorized(reply);
    }
    if (
      !authLimiter.allow("email-verification-global", 60, 60_000) ||
      !authLimiter.allow(
        `email-verification-account:${account.id}`,
        3,
        15 * 60_000,
      ) ||
      !authLimiter.allow(
        `email-verification-email:${emailKey}`,
        3,
        15 * 60_000,
      ) ||
      !authLimiter.allow(
        `email-verification-ip:${request.ip}`,
        8,
        15 * 60_000,
      )
    ) {
      return reply.status(429).send({
        code: "RATE_LIMITED",
        message: "验证码请求过于频繁，请稍后再试",
      });
    }

    try {
      return reply.status(202).send({
        data: await authService.requestEmailVerification(
          account.id,
          parsed.data,
        ),
      });
    } catch (error) {
      return sendAuthError(error, reply);
    }
  });

  app.post<{
    Body: z.infer<typeof emailVerificationConfirmSchema>;
    Reply:
      | ApiEnvelope<PublicAccount>
      | ApiEnvelope<RegistrationEmailVerificationConfirmResult>
      | ApiError;
  }>("/api/account/email-verification/confirm", async (request, reply) => {
    const parsed = emailVerificationConfirmSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_EMAIL_VERIFICATION_CONFIRMATION",
        message: parsed.error.issues[0]?.message ?? "验证码格式无效",
      });
    }

    if (parsed.data.purpose === "REGISTRATION") {
      if (
        !authLimiter.allow(
          `registration-email-confirm:${parsed.data.email.toLowerCase()}:${request.ip}`,
          10,
          15 * 60_000,
        )
      ) {
        return reply.status(429).send({
          code: "RATE_LIMITED",
          message: "验证码尝试过于频繁，请稍后再试",
        });
      }
      try {
        return {
          data: await authService.confirmRegistrationEmailVerification(
            parsed.data,
          ),
        };
      } catch (error) {
        return sendAuthError(error, reply);
      }
    }

    const account = requireAccount(request, authService);
    if (!account) {
      return unauthorized(reply);
    }
    if (
      !authLimiter.allow(
        `email-verification-confirm:${account.id}:${request.ip}`,
        10,
        15 * 60_000,
      )
    ) {
      return reply.status(429).send({
        code: "RATE_LIMITED",
        message: "验证码尝试过于频繁，请稍后再试",
      });
    }

    try {
      return {
        data: await authService.confirmEmailVerification(
          account.id,
          parsed.data,
        ),
      };
    } catch (error) {
      return sendAuthError(error, reply);
    }
  });

  app.post<{
    Reply: ApiEnvelope<{ loggedOut: true }>;
  }>("/api/auth/logout", async (request) => {
    await authService.logout(request.headers.authorization);
    return {
      data: { loggedOut: true },
    };
  });

  app.put<{
    Body: { currency: DisplayCurrency };
    Reply: ApiEnvelope<PublicAccount> | ApiError;
  }>("/api/account/display-currency", async (request, reply) => {
    const account = requireAccount(request, authService);

    if (!account) {
      return unauthorized(reply);
    }

    const parsed = currencySchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_CURRENCY",
        message: "显示币种只支持人民币或美元",
      });
    }

    return {
      data: await authService.setDisplayCurrency(
        account.id,
        parsed.data.currency,
      ),
    };
  });

  app.get<{
    Querystring: Record<string, string | undefined>;
    Reply: ApiEnvelope<PaginatedData<Instrument>> | ApiError;
  }>("/api/instruments", async (request, reply) => {
    const parsed = listingSchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_QUERY",
        message: "行情筛选参数无效",
      });
    }

    if (parsed.data.mode === "REAL") {
      const result = realRepository.listMarket(parsed.data);
      return {
        data: {
          ...result,
          items: result.items.map((item) => item.instrument),
        },
      };
    }

    let virtualInstrumentIds: Set<string> | undefined;
    if (parsed.data.watchlist) {
      const account = requireAccount(request, authService);
      if (!account) {
        return unauthorized(reply);
      }
      const records = await accountFeatureStore.listWatchlist(
        account.id,
        "VIRTUAL",
      );
      virtualInstrumentIds = new Set(
        records.map((record) => record.instrumentId),
      );
    }
    const result = filterInstruments(
      repository,
      parsed.data,
      virtualInstrumentIds,
    );
    return {
      data: {
        ...result,
        items: result.items.map(toPublicInstrument),
      },
    };
  });

  app.get<{
    Params: { instrumentId: string };
    Querystring: { mode?: MarketMode };
    Reply: ApiEnvelope<MarketItem> | ApiError;
  }>("/api/instruments/:instrumentId", async (request, reply) => {
    const parsed = modeSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_MODE",
        message: "模拟盘类型无效",
      });
    }
    if (parsed.data.mode === "REAL") {
      const item = realRepository.getMarketItem(
        request.params.instrumentId,
      );
      if (!item) {
        return reply.status(404).send({
          code: "INSTRUMENT_NOT_FOUND",
          message: "真实行情数据库中没有找到这只股票",
        });
      }
      realRuntime.touchInstrument(request.params.instrumentId, "DETAIL");
      return { data: item };
    }

    const instrument = repository.getInstrumentById(
      request.params.instrumentId,
    );
    const quote = repository.getQuote(request.params.instrumentId);

    if (!instrument || !quote) {
      return reply.status(404).send({
        code: "INSTRUMENT_NOT_FOUND",
        message: "没有找到这只股票",
      });
    }

    return {
      data: {
        instrument: toPublicInstrument(instrument),
        quote,
      },
    };
  });

  app.get<{
    Params: { instrumentId: string };
    Querystring: { range?: ChartRange; mode?: MarketMode };
    Reply: ApiEnvelope<ChartSeries> | ApiError;
  }>("/api/instruments/:instrumentId/chart", async (request, reply) => {
    const parsed = chartSchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_CHART_RANGE",
        message: "图表周期参数无效",
      });
    }

    const chart =
      parsed.data.mode === "REAL"
        ? await realMarketDetailService.getChart(
            request.params.instrumentId,
            parsed.data.range,
          )
        : await marketDetailService.getChart(
            request.params.instrumentId,
            parsed.data.range,
          );

    if (!chart) {
      return reply.status(404).send({
        code: "INSTRUMENT_NOT_FOUND",
        message: "没有找到这只股票",
      });
    }

    return { data: chart };
  });

  app.get<{
    Params: { instrumentId: string };
    Querystring: { mode?: MarketMode };
    Reply: ApiEnvelope<OrderBookSnapshot> | ApiError;
  }>("/api/instruments/:instrumentId/order-book", async (request, reply) => {
    const parsed = modeSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_MODE",
        message: "模拟盘类型无效",
      });
    }
    const orderBook =
      parsed.data.mode === "REAL"
        ? await realMarketDetailService.getOrderBook(
            request.params.instrumentId,
          )
        : marketDetailService.getOrderBook(
            request.params.instrumentId,
          );

    if (!orderBook) {
      return reply.status(404).send({
        code: "INSTRUMENT_NOT_FOUND",
        message: "没有找到这只股票",
      });
    }

    return { data: orderBook };
  });

  app.get<{
    Querystring: Record<string, string | undefined>;
    Reply: ApiEnvelope<PaginatedData<MarketItem>> | ApiError;
  }>("/api/market", async (request, reply) => {
    const parsed = listingSchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_QUERY",
        message: "行情筛选参数无效",
      });
    }

    if (parsed.data.mode === "REAL") {
      let instrumentIds: Set<string> | undefined;
      if (parsed.data.watchlist) {
        const account = requireAccount(request, authService);
        if (!account) {
          return unauthorized(reply);
        }
        const records = await accountFeatureStore.listWatchlist(
          account.id,
          "REAL",
        );
        instrumentIds = new Set(
          records.map((record) => record.instrumentId),
        );
      }
      const result = realRepository.listMarket({
        ...parsed.data,
        instrumentIds,
      });
      for (const item of result.items) {
        realRuntime.touchInstrument(
          item.instrument.id,
          "VISIBLE",
        );
      }
      return { data: result };
    }

    let virtualInstrumentIds: Set<string> | undefined;
    if (parsed.data.watchlist) {
      const account = requireAccount(request, authService);
      if (!account) {
        return unauthorized(reply);
      }
      const records = await accountFeatureStore.listWatchlist(
        account.id,
        "VIRTUAL",
      );
      virtualInstrumentIds = new Set(
        records.map((record) => record.instrumentId),
      );
    }
    const result = filterInstruments(
      repository,
      parsed.data,
      virtualInstrumentIds,
    );
    const items = result.items
      .map((instrument): MarketItem | null => {
        const quote = repository.getQuote(instrument.id);

        return quote
          ? {
              instrument: toPublicInstrument(instrument),
              quote,
            }
          : null;
      })
      .filter((item): item is MarketItem => item !== null);

    return {
      data: {
        items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      },
    };
  });

  app.get<{
    Querystring: { mode?: MarketMode };
    Reply: ApiEnvelope<Quote[]> | ApiError;
  }>("/api/quotes", async (request, reply) => {
    const parsed = modeSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_MODE",
        message: "模拟盘类型无效",
      });
    }
    return {
      data:
        parsed.data.mode === "REAL"
          ? realRepository.listQuotes()
          : repository.listQuotes(),
    };
  });

  app.get<{
    Reply: ApiEnvelope<RealMarketStatus>;
  }>("/api/real-market/status", async () => ({
    data: realRuntime.getStatus(),
  }));

  app.get<{
    Reply: ApiEnvelope<AITradingStatus>;
  }>("/api/ai/status", async () => ({
    data: aiTradingService.getStatus(),
  }));

  app.get("/api/ai/llm/status", async () => ({
    data: llmTradingRuntime.getStatus(),
  }));

  app.get("/api/ai/market-state/status", async () => ({
    data: marketStateService.getStatus(),
  }));

  app.get<{
    Querystring: { limit?: string };
    Reply: ApiEnvelope<ReturnType<MarketStateService["listEvents"]>> | ApiError;
  }>("/api/ai/market-events", async (request, reply) => {
    const parsed = rankingSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_EVENT_QUERY",
        message: "事件数量参数无效",
      });
    }
    return {
      data: marketStateService.listEvents().slice(0, parsed.data.limit),
    };
  });

  app.get<{
    Querystring: { limit?: string };
    Reply: ApiEnvelope<AITraderRankingItem[]> | ApiError;
  }>("/api/ai/ranking", async (request, reply) => {
    const parsed = rankingSchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_QUERY",
        message: "AI 排行榜参数无效",
      });
    }

    return {
      data: aiTradingService.getRanking(parsed.data.limit),
    };
  });

  app.get<{
    Querystring: { mode?: MarketMode };
    Reply: ApiEnvelope<PortfolioSnapshot> | ApiError;
  }>("/api/account", async (request, reply) => {
    const account = requireAccount(request, authService);

    if (!account) {
      return unauthorized(reply);
    }

    const parsed = modeSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_MODE",
        message: "模拟盘类型无效",
      });
    }
    if (parsed.data.mode === "REAL") {
      return {
        data: await realTradingService.getSnapshot(
          account.id,
          account.displayCurrency,
        ),
      };
    }
    await tradeService.settleDuePositions();
    return { data: portfolioService.getSnapshot(account.id) };
  });

  app.get<{
    Querystring: { mode?: MarketMode };
    Reply: ApiEnvelope<Transaction[]> | ApiError;
  }>("/api/account/transactions", async (request, reply) => {
    const account = requireAccount(request, authService);

    if (!account) {
      return unauthorized(reply);
    }

    const parsed = modeSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_MODE",
        message: "模拟盘类型无效",
      });
    }
    if (parsed.data.mode === "REAL") {
      return {
        data: await realTradingService.listTransactions(account.id),
      };
    }

    const portfolio = repository.getPortfolioByAccountId(account.id);
    if (!portfolio) {
      return reply.status(404).send({
        code: "PORTFOLIO_NOT_FOUND",
        message: "模拟账户不存在",
      });
    }

    return {
      data: repository.listTransactions(portfolio.id),
    };
  });

  app.get<{
    Querystring: Record<string, string | undefined>;
    Reply: ApiEnvelope<IndustrySummary[]> | ApiError;
  }>("/api/industries", async (request, reply) => {
    const parsed = industryDirectorySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_QUERY",
        message: "行业筛选参数无效",
      });
    }

    const instruments = parsed.data.mode === "REAL"
      ? realRepository
          .listInstruments()
          .filter((instrument) => realRepository.getQuote(instrument.id))
      : repository
          .listInstruments()
          .filter((instrument) => repository.getQuote(instrument.id));
    return {
      data: summarizeIndustries(instruments, parsed.data.market),
    };
  });

  app.get<{
    Querystring: { mode?: MarketMode; status?: string };
    Reply: ApiEnvelope<LimitOrder[]> | ApiError;
  }>("/api/account/orders", async (request, reply) => {
    const account = requireAccount(request, authService);
    if (!account) {
      return unauthorized(reply);
    }
    const parsed = orderListSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_ORDER_QUERY",
        message: "委托查询参数无效",
      });
    }
    try {
      return {
        data:
          parsed.data.mode === "REAL"
            ? await realTradingService.listOrders(
                account.id,
                parsed.data.status,
              )
            : tradeService.listOrders(
                account.id,
                parsed.data.status,
              ),
      };
    } catch (error) {
      if (
        error instanceof TradeError ||
        error instanceof RealTradeError
      ) {
        return reply.status(error.statusCode).send({
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }
  });

  app.post<{
    Body: TradeRequest & { mode?: MarketMode };
    Reply: ApiEnvelope<OrderSubmissionResult> | ApiError;
  }>("/api/orders", async (request, reply) => {
    const account = requireAccount(request, authService);
    if (!account) {
      return unauthorized(reply);
    }
    const parsed = orderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_ORDER_REQUEST",
        message:
          parsed.error.issues[0]?.message ?? "委托参数无效",
      });
    }
    try {
      const { mode, ...orderRequest } = parsed.data;
      return reply.status(201).send({
        data:
          mode === "REAL"
            ? await realTradingService.placeOrder(
                account.id,
                account.displayCurrency,
                orderRequest,
              )
            : await tradeService.placeOrder(
                account.id,
                orderRequest,
              ),
      });
    } catch (error) {
      if (
        error instanceof TradeError ||
        error instanceof RealTradeError
      ) {
        return reply.status(error.statusCode).send({
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }
  });

  app.delete<{
    Params: { orderId: string };
    Querystring: { mode?: MarketMode };
    Reply: ApiEnvelope<OrderCancellationResult> | ApiError;
  }>("/api/orders/:orderId", async (request, reply) => {
    const account = requireAccount(request, authService);
    if (!account) {
      return unauthorized(reply);
    }
    const parsed = modeSchema.safeParse(request.query);
    if (!parsed.success || !request.params.orderId.trim()) {
      return reply.status(400).send({
        code: "INVALID_ORDER_REQUEST",
        message: "撤单参数无效",
      });
    }
    try {
      return {
        data:
          parsed.data.mode === "REAL"
            ? await realTradingService.cancelOrder(
                account.id,
                account.displayCurrency,
                request.params.orderId,
              )
            : await tradeService.cancelOrder(
                account.id,
                request.params.orderId,
              ),
      };
    } catch (error) {
      if (
        error instanceof TradeError ||
        error instanceof RealTradeError
      ) {
        return reply.status(error.statusCode).send({
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }
  });

  app.post<{
    Body: TradeRequest & { mode?: MarketMode };
    Reply: ApiEnvelope<TradeResult> | ApiError;
  }>("/api/trades", async (request, reply) => {
    const account = requireAccount(request, authService);

    if (!account) {
      return unauthorized(reply);
    }

    const parsed = tradeSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message:
          parsed.error.issues[0]?.message ?? "交易参数无效",
      });
    }

    try {
      const { mode, ...tradeRequest } = parsed.data;
      return reply.status(201).send({
        data:
          mode === "REAL"
            ? await realTradingService.execute(
                account.id,
                account.displayCurrency,
                tradeRequest,
              )
            : await tradeService.execute(account.id, tradeRequest),
      });
    } catch (error) {
      if (
        error instanceof TradeError ||
        error instanceof RealTradeError
      ) {
        return reply.status(error.statusCode).send({
          code: error.code,
          message: error.message,
        });
      }

      throw error;
    }
  });

  app.get<{
    Querystring: { mode?: MarketMode };
    Reply: ApiEnvelope<WatchlistState> | ApiError;
  }>("/api/watchlist", async (request, reply) => {
    const account = requireAccount(request, authService);
    if (!account) {
      return unauthorized(reply);
    }
    const parsed = modeSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_MODE",
        message: "模拟盘类型无效",
      });
    }
    const records = await accountFeatureStore.listWatchlist(
      account.id,
      parsed.data.mode,
    );
    const items = records.map((record) => ({
      mode: record.mode,
      instrumentId: record.instrumentId,
      createdAt: record.createdAt,
      marketItem:
        record.mode === "REAL"
          ? realRepository.getMarketItem(record.instrumentId) ?? null
          : virtualMarketItem(repository, record.instrumentId),
    }));
    return {
      data: {
        mode: parsed.data.mode,
        items,
        instrumentIds: records.map((record) => record.instrumentId),
        limit: WATCHLIST_LIMIT,
      },
    };
  });

  app.post<{
    Body: z.infer<typeof watchlistMutationSchema>;
    Reply: ApiEnvelope<WatchlistState> | ApiError;
  }>("/api/watchlist", async (request, reply) => {
    const account = requireAccount(request, authService);
    if (!account) {
      return unauthorized(reply);
    }
    const parsed = watchlistMutationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_WATCHLIST_ITEM",
        message: "自选股参数无效",
      });
    }
    const exists =
      parsed.data.mode === "REAL"
        ? realRepository.getInstrumentById(parsed.data.instrumentId)
        : repository.getInstrumentById(parsed.data.instrumentId);
    if (!exists) {
      return reply.status(404).send({
        code: "INSTRUMENT_NOT_FOUND",
        message: "没有找到这只股票",
      });
    }
    try {
      await accountFeatureStore.addWatchlist(
        account.id,
        parsed.data.mode,
        parsed.data.instrumentId,
      );
      if (parsed.data.mode === "REAL") {
        realRuntime.touchInstrument(
          parsed.data.instrumentId,
          "DETAIL",
        );
      }
      const records = await accountFeatureStore.listWatchlist(
        account.id,
        parsed.data.mode,
      );
      return reply.status(201).send({
        data: {
          mode: parsed.data.mode,
          items: records.map((record) => ({
            mode: record.mode,
            instrumentId: record.instrumentId,
            createdAt: record.createdAt,
            marketItem:
              record.mode === "REAL"
                ? realRepository.getMarketItem(record.instrumentId) ??
                  null
                : virtualMarketItem(
                    repository,
                    record.instrumentId,
                  ),
          })),
          instrumentIds: records.map(
            (record) => record.instrumentId,
          ),
          limit: WATCHLIST_LIMIT,
        },
      });
    } catch (error) {
      return sendAccountFeatureError(error, reply);
    }
  });

  app.delete<{
    Body: z.infer<typeof watchlistMutationSchema>;
    Reply: ApiEnvelope<WatchlistState> | ApiError;
  }>("/api/watchlist", async (request, reply) => {
    const account = requireAccount(request, authService);
    if (!account) {
      return unauthorized(reply);
    }
    const parsed = watchlistMutationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_WATCHLIST_ITEM",
        message: "自选股参数无效",
      });
    }
    await accountFeatureStore.removeWatchlist(
      account.id,
      parsed.data.mode,
      parsed.data.instrumentId,
    );
    const records = await accountFeatureStore.listWatchlist(
      account.id,
      parsed.data.mode,
    );
    return {
      data: {
        mode: parsed.data.mode,
        items: records.map((record) => ({
          mode: record.mode,
          instrumentId: record.instrumentId,
          createdAt: record.createdAt,
          marketItem:
            record.mode === "REAL"
              ? realRepository.getMarketItem(record.instrumentId) ??
                null
              : virtualMarketItem(repository, record.instrumentId),
        })),
        instrumentIds: records.map((record) => record.instrumentId),
        limit: WATCHLIST_LIMIT,
      },
    };
  });

  app.get<{
    Reply: ApiEnvelope<DailyCheckInStatus> | ApiError;
  }>("/api/rewards/check-in", async (request, reply) => {
    const account = requireAccount(request, authService);
    if (!account) {
      return unauthorized(reply);
    }
    return {
      data: await rewardService.getCheckInStatus(account.id),
    };
  });

  app.post<{
    Body: z.infer<typeof checkInSchema>;
    Reply: ApiEnvelope<RewardClaimResult> | ApiError;
  }>("/api/rewards/check-in", async (request, reply) => {
    const account = requireAccount(request, authService);
    if (!account) {
      return unauthorized(reply);
    }
    const parsed = checkInSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_MODE",
        message: "请选择奖励进入哪个模拟盘",
      });
    }
    try {
      return reply.status(201).send({
        data: await rewardService.checkIn(
          account.id,
          parsed.data.mode,
          account.displayCurrency,
        ),
      });
    } catch (error) {
      return sendAccountFeatureError(error, reply);
    }
  });

  app.post<{
    Body: z.infer<typeof giftCodeSchema>;
    Reply: ApiEnvelope<RewardClaimResult> | ApiError;
  }>("/api/rewards/gift-code", async (request, reply) => {
    const account = requireAccount(request, authService);
    if (!account) {
      return unauthorized(reply);
    }
    const parsed = giftCodeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_GIFT_CODE_REQUEST",
        message: "礼包码参数无效",
      });
    }
    try {
      return reply.status(201).send({
        data: await rewardService.redeemGiftCode(
          account.id,
          parsed.data.mode,
          parsed.data.code,
          parsed.data.idempotencyKey,
          account.displayCurrency,
        ),
      });
    } catch (error) {
      return sendAccountFeatureError(error, reply);
    }
  });

  app.get<{
    Querystring: {
      market?: StockMarket;
      instrumentId?: string;
      mode?: MarketMode;
    };
  }>("/ws/market", { websocket: true }, (socket, request) => {
    const market = request.query.market;
    const instrumentId = request.query.instrumentId;
    const mode = request.query.mode ?? "VIRTUAL";
    const matches = (quote: Quote) =>
      (!market || quote.market === market) &&
      (!instrumentId || quote.instrumentId === instrumentId);
    const snapshot: MarketSocketMessage = {
      type: "snapshot",
      data:
        mode === "REAL"
          ? instrumentId
            ? realRepository.listQuotes().filter(matches)
            : []
          : repository.listQuotes().filter(matches),
    };
    socket.send(JSON.stringify(snapshot));

    const handleQuotes = (nextQuotes: Quote[]) => {
      if (socket.readyState !== 1) {
        return;
      }

      const data = nextQuotes.filter(matches);

      if (data.length === 0) {
        return;
      }

      const message: MarketSocketMessage = {
        type: "quote_update",
        data,
      };
      socket.send(JSON.stringify(message));
    };
    const unsubscribe =
      mode === "REAL"
        ? instrumentId
          ? realRuntime.subscribe(handleQuotes)
          : () => undefined
        : runtime.subscribe(handleQuotes);

    socket.on("close", unsubscribe);
    socket.on("error", unsubscribe);
  });

  if (staticWeb) {
    await registerStaticWeb(app, staticWeb.root);
  }

  app.addHook("onClose", async () => {
    if (quickTimer) { clearInterval(quickTimer); quickTimer = null; }
    if (deepTimer) { clearInterval(deepTimer); deepTimer = null; }
    loadController.stop();
    await rootConfigWatcher?.stop();
    runtime.stop();
    aiRuntime.stop();
    await llmTradingRuntime?.stopAndWait();
    realRuntime.stop();
    unsubscribeVirtualOrderMatcher();
    unsubscribeRealOrderMatcher();
    await candleService.flush();
    await realRuntime.waitForStop();

    if (ownedConnection) {
      await ownedConnection.client.close();
    }
    if (ownedRealConnection) {
      await ownedRealConnection.client.close();
    }
  });

  return {
    app,
    repository,
    runtime,
    aiRuntime,
    aiTradingService,
    llmTradingRuntime,
    get llmTradingService() {
      return llmTradingRuntime.service;
    },
    authService,
    candleService,
    marketDetailService,
    portfolioService,
    tradeService,
    realRepository,
    realRuntime,
    realMarketDetailService,
    realTradingService,
    accountFeatureStore,
    rewardService,
    loadController,
    marketStateService,
  };
}

interface ListingFilter {
  market?: StockMarket;
  industry?: string;
  search?: string;
  page: number;
  pageSize: number;
  sortBy: "DEFAULT" | "CHANGE_PERCENT";
  sortOrder: "DESC" | "ASC";
}

function filterInstruments(
  repository: GameRepository,
  filter: ListingFilter,
  instrumentIds?: ReadonlySet<string>,
) {
  const query = filter.search?.toLocaleLowerCase("zh-CN") ?? "";
  const filtered = repository
    .listInstruments()
    .filter(
      (instrument) =>
        repository.getQuote(instrument.id) !== undefined &&
        (!instrumentIds || instrumentIds.has(instrument.id)) &&
        (!filter.market || instrument.market === filter.market) &&
        (!filter.industry ||
          normalizeIndustry(instrument.industry) === filter.industry) &&
        (!query ||
          instrument.symbol.toLowerCase().includes(query) ||
          instrument.name
            .toLocaleLowerCase("zh-CN")
            .includes(query) ||
          normalizeIndustry(instrument.industry)
            .toLocaleLowerCase("zh-CN")
            .includes(query)),
    )
    .sort((left, right) =>
      compareVirtualInstruments(repository, filter, left, right)
    );
  const start = (filter.page - 1) * filter.pageSize;

  return {
    items: filtered.slice(start, start + filter.pageSize),
    total: filtered.length,
    page: filter.page,
    pageSize: filter.pageSize,
  };
}

function toPublicInstrument(
  instrument: ReturnType<GameRepository["listInstruments"]>[number],
): Instrument {
  const {
    initialPrice: _initialPrice,
    volatility: _volatility,
    liquidity: _liquidity,
    ...publicInstrument
  } = instrument;
  return {
    ...publicInstrument,
    industry: normalizeIndustry(publicInstrument.industry),
  };
}

function summarizeIndustries(
  instruments: ReadonlyArray<{ market: StockMarket; industry: string }>,
  market?: StockMarket,
): IndustrySummary[] {
  const counts = new Map<string, number>();
  for (const instrument of instruments) {
    if (market && instrument.market !== market) {
      continue;
    }
    const industry = normalizeIndustry(instrument.industry);
    counts.set(industry, (counts.get(industry) ?? 0) + 1);
  }
  return [...counts]
    .map(([industry, count]) => ({ industry, count }))
    .sort((left, right) =>
      left.industry.localeCompare(right.industry, "zh-CN"),
    );
}

function normalizeIndustry(industry: string): string {
  const normalized = industry.trim();
  return isIndustryPlaceholder(normalized)
    ? UNKNOWN_INDUSTRY
    : normalized;
}

function isIndustryPlaceholder(industry: string): boolean {
  return ["", "-", "--", "N/A", "NA", "NONE", "NULL", "UNKNOWN", "未知"].includes(
    industry.toLocaleUpperCase("en-US"),
  );
}

function virtualMarketItem(
  repository: GameRepository,
  instrumentId: string,
): MarketItem | null {
  const instrument = repository.getInstrumentById(instrumentId);
  const quote = repository.getQuote(instrumentId);
  return instrument && quote
    ? {
        instrument: toPublicInstrument(instrument),
        quote,
      }
    : null;
}

function compareVirtualInstruments(
  repository: GameRepository,
  filter: ListingFilter,
  left: ReturnType<GameRepository["listInstruments"]>[number],
  right: ReturnType<GameRepository["listInstruments"]>[number],
): number {
  if (filter.sortBy === "CHANGE_PERCENT") {
    const leftQuote = repository.getQuote(left.id);
    const rightQuote = repository.getQuote(right.id);
    const byChange = compareByNumber(
      leftQuote?.changePercent ?? 0,
      rightQuote?.changePercent ?? 0,
      filter.sortOrder,
    );
    if (byChange !== 0) {
      return byChange;
    }
  }
  return compareVirtualInstrumentFallback(left, right);
}

function compareVirtualInstrumentFallback(
  left: ReturnType<GameRepository["listInstruments"]>[number],
  right: ReturnType<GameRepository["listInstruments"]>[number],
): number {
  const marketOrder: Record<StockMarket, number> = {
    CN: 0,
    HK: 1,
    US: 2,
    UK: 3,
  };
  return (
    marketOrder[left.market] - marketOrder[right.market] ||
    left.symbol.localeCompare(right.symbol)
  );
}

function compareByNumber(
  left: number,
  right: number,
  order: "DESC" | "ASC",
): number {
  return order === "ASC" ? left - right : right - left;
}

function requireAccount(
  request: FastifyRequest,
  authService: AuthService,
): AccountRecord | undefined {
  return authService.authenticate(request.headers.authorization);
}

function unauthorized(reply: FastifyReply) {
  return reply.status(401).send({
    code: "AUTH_REQUIRED",
    message: "交易前请先注册或登录",
  });
}

function sendAuthError(
  error: unknown,
  reply: FastifyReply,
) {
  if (error instanceof AuthError) {
    return reply.status(error.statusCode).send({
      code: error.code,
      message: error.message,
    });
  }

  throw error;
}

function sendAccountFeatureError(
  error: unknown,
  reply: FastifyReply,
) {
  if (error instanceof AccountFeatureError) {
    return reply.status(error.statusCode).send({
      code: error.code,
      message: error.message,
    });
  }
  throw error;
}

interface StaticWebConfiguration {
  root: string;
}

const DEFAULT_WEB_ROOT = fileURLToPath(
  new URL("../../web/dist/", import.meta.url),
);

async function resolveStaticWebConfiguration(
  options: CreateApplicationOptions,
): Promise<StaticWebConfiguration | null> {
  const enabled =
    options.serveWeb ??
    process.env.SERVE_WEB?.trim().toLowerCase() === "true";

  if (!enabled) {
    return null;
  }

  const configuredRoot =
    options.webRoot ?? process.env.WEB_DIST_DIR ?? DEFAULT_WEB_ROOT;
  const root = isAbsolute(configuredRoot)
    ? configuredRoot
    : resolve(configuredRoot);
  const indexPath = join(root, "index.html");

  try {
    await access(indexPath, fsConstants.R_OK);
  } catch (error) {
    throw new Error(
      `SERVE_WEB=true, but the production web entry was not found at ${indexPath}. Run "npm run build" before starting the server.`,
      { cause: error },
    );
  }

  return { root };
}

async function registerStaticWeb(
  app: FastifyInstance,
  root: string,
): Promise<void> {
  await app.register(fastifyStatic, {
    root,
    cacheControl: false,
    dotfiles: "deny",
    serveDotFiles: false,
    allowedPath(pathName, _root, request) {
      const candidatePath = pathName.startsWith("/")
        ? pathName
        : `/${pathName}`;
      return (
        !hasUnsafeStaticPath(request.url) &&
        !hasUnsafeStaticPath(candidatePath) &&
        !isServicePath(request.url) &&
        !isServicePath(candidatePath)
      );
    },
    setHeaders(reply, filePath) {
      const normalizedPath = filePath.replaceAll("\\", "/");

      if (normalizedPath.endsWith("/index.html")) {
        reply.header("Cache-Control", "no-store");
        return;
      }
      if (normalizedPath.includes("/assets/")) {
        reply.header(
          "Cache-Control",
          "public, max-age=31536000, immutable",
        );
        return;
      }
      reply.header("Cache-Control", "public, max-age=3600");
    },
  });

  app.setNotFoundHandler((request, reply) => {
    if (
      hasUnsafeStaticPath(request.url) ||
      isServicePath(request.url) ||
      !isHtmlNavigationRequest(request)
    ) {
      return reply
        .status(404)
        .type("application/json; charset=utf-8")
        .send({
          statusCode: 404,
          error: "Not Found",
          message: `Route ${request.method}:${request.url.split("?")[0]} not found`,
        });
    }

    return reply
      .header("Cache-Control", "no-store")
      .type("text/html; charset=utf-8")
      .sendFile("index.html", {
        cacheControl: false,
        immutable: false,
        maxAge: 0,
      });
  });
}

function isServicePath(requestUrl: string): boolean {
  const { decodedPath } = inspectRequestPath(requestUrl);
  if (!decodedPath) {
    return false;
  }
  return (
    decodedPath === "/api" ||
    decodedPath.startsWith("/api/") ||
    decodedPath === "/ws" ||
    decodedPath.startsWith("/ws/")
  );
}

function hasUnsafeStaticPath(requestUrl: string): boolean {
  return inspectRequestPath(requestUrl).unsafe;
}

function inspectRequestPath(requestUrl: string): {
  decodedPath: string | null;
  unsafe: boolean;
} {
  const pathName = requestUrl.split(/[?#]/, 1)[0] ?? requestUrl;
  let decodedPath = pathName;
  let unsafe = false;

  for (let pass = 0; pass < 8; pass += 1) {
    if (
      decodedPath.includes("\\") ||
      /%(?:2f|5c)/i.test(decodedPath)
    ) {
      unsafe = true;
    }

    let nextPath: string;
    try {
      nextPath = decodeURIComponent(decodedPath);
    } catch {
      return { decodedPath: null, unsafe: true };
    }

    if (nextPath === decodedPath) {
      break;
    }
    decodedPath = nextPath;
  }

  const normalizedSeparators = decodedPath.replaceAll("\\", "/");
  if (/[\u0000-\u001f\u007f]/u.test(normalizedSeparators)) {
    unsafe = true;
  }
  if (
    normalizedSeparators
      .split("/")
      .some((segment) => segment === "." || segment === "..")
  ) {
    unsafe = true;
  }

  return {
    decodedPath: normalizedSeparators,
    unsafe,
  };
}

function runtimeMemoryStatus() {
  const memory = process.memoryUsage();
  const heapLimitBytes = getHeapStatistics().heap_size_limit;
  return {
    rssMb: roundMegabytes(memory.rss),
    heapUsedMb: roundMegabytes(memory.heapUsed),
    heapTotalMb: roundMegabytes(memory.heapTotal),
    externalMb: roundMegabytes(memory.external),
    heapLimitMb: roundMegabytes(heapLimitBytes),
  };
}

function roundMegabytes(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

function isHtmlNavigationRequest(request: FastifyRequest): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }

  const accept = request.headers.accept?.toLowerCase() ?? "";
  return accept
    .split(",")
    .map((mediaRange) => mediaRange.split(";", 1)[0]?.trim())
    .some(
      (mediaType) =>
        mediaType === "text/html" ||
        mediaType === "application/xhtml+xml",
    );
}

class WindowRateLimiter {
  readonly #attempts = new Map<string, number[]>();
  #lastCleanupAt = 0;

  allow(
    key: string,
    maximum: number,
    windowMs: number,
  ): boolean {
    const now = Date.now();
    this.#cleanup(now);
    const cutoff = now - windowMs;
    const recent = (this.#attempts.get(key) ?? []).filter(
      (timestamp) => timestamp > cutoff,
    );

    if (recent.length >= maximum) {
      this.#attempts.set(key, recent);
      return false;
    }

    recent.push(now);
    this.#attempts.set(key, recent);
    return true;
  }

  #cleanup(now: number): void {
    if (
      now - this.#lastCleanupAt < 60_000 &&
      this.#attempts.size < 10_000
    ) {
      return;
    }
    this.#lastCleanupAt = now;
    const cutoff = now - 15 * 60_000;
    for (const [key, attempts] of this.#attempts) {
      const recent = attempts.filter((timestamp) => timestamp > cutoff);
      if (recent.length === 0) {
        this.#attempts.delete(key);
      } else if (recent.length !== attempts.length) {
        this.#attempts.set(key, recent);
      }
    }
    while (this.#attempts.size > 20_000) {
      const oldestKey = this.#attempts.keys().next().value as
        | string
        | undefined;
      if (!oldestKey) {
        break;
      }
      this.#attempts.delete(oldestKey);
    }
  }
}
