import { randomUUID } from "node:crypto";
import type { Quote } from "@gupiaomoniqi/shared";
import type {
  GameRepository,
  InstrumentRecord,
  OwnershipPositionRecord,
} from "../repositories/GameRepository.js";
import {
  MemoryVirtualMarketStateStore,
  type MarketRegimePhase,
  type MarketStateScopeType,
  type VirtualInstrumentStateRecord,
  type VirtualMarketEventRecord,
  type VirtualMarketRegimeRecord,
  type VirtualMarketStateStore,
} from "./MarketStateStore.js";

const DAY_MS = 24 * 60 * 60_000;
const OWNERSHIP_REFRESH_MS = 60_000;
const PERSISTENCE_INTERVAL_MS = 5 * 60_000;
const AUTOMATIC_EVENT_MINIMUM_INTERVAL_MS = 4 * 60 * 60_000;
const AUTOMATIC_EVENT_MAXIMUM_INTERVAL_MS = 12 * 60 * 60_000;
const FUNDAMENTAL_CONVERGENCE_DAYS = 4;
const MAXIMUM_OWNERSHIP_PREMIUM = 0.12;

export interface VirtualMarketSignal {
  instrumentId: string;
  fundamentalValue: number;
  targetPrice: number;
  fundamentalGap: number;
  expectedDailyReturn: number;
  marketDriftPerDay: number;
  sectorDriftPerDay: number;
  ownershipPremium: number;
  ownershipConcentration: number;
  eventSentiment: number;
  volatilityMultiplier: number;
  qualityScore: number;
  growthScore: number;
  leverageRisk: number;
  signalVersion: string;
}

export interface ScheduleVirtualMarketEventInput {
  kind: string;
  scopeType: MarketStateScopeType;
  scopeKey: string;
  headline: string;
  fundamentalImpact: number;
  sentimentImpact: number;
  volatilityMultiplier?: number;
  startsAt?: string;
  durationMs: number;
  decayHalfLifeMs: number;
}

export interface VirtualMarketStateStatus {
  instrumentCount: number;
  activeEventCount: number;
  totalEventCount: number;
  regimeCounts: Record<MarketRegimePhase, number>;
  averageOwnershipPremium: number;
  maximumOwnershipPremium: number;
  lastRefreshAt: string | null;
  signalVersion: string;
}

export class MarketStateService {
  readonly #instrumentById = new Map<string, InstrumentRecord>();
  readonly #states = new Map<string, VirtualInstrumentStateRecord>();
  readonly #regimes = new Map<string, VirtualMarketRegimeRecord>();
  readonly #events = new Map<string, VirtualMarketEventRecord>();
  readonly #eventSentiment = new Map<string, number>();
  readonly #eventVolatility = new Map<string, number>();
  #initializing: Promise<void> | null = null;
  #initialized = false;
  #lastRefreshAtMs: number | null = null;
  #lastRefreshAt: string | null = null;
  #nextOwnershipRefreshAtMs = 0;
  #nextPersistenceAtMs = 0;
  #nextAutomaticEventAtMs = Number.POSITIVE_INFINITY;
  #signalSequence = 0;

  constructor(
    private readonly repository: GameRepository,
    instruments: InstrumentRecord[],
    private readonly store: VirtualMarketStateStore =
      new MemoryVirtualMarketStateStore(),
    private readonly random: () => number = Math.random,
    private readonly clock: () => Date = () => new Date(),
    private readonly automaticEvents = true,
  ) {
    for (const instrument of instruments) {
      this.#instrumentById.set(instrument.id, instrument);
    }
  }

  async initialize(quotes: readonly Quote[] = []): Promise<void> {
    if (this.#initialized) {
      return;
    }
    if (this.#initializing) {
      return this.#initializing;
    }
    this.#initializing = this.#initialize(quotes);
    try {
      await this.#initializing;
      this.#initialized = true;
    } finally {
      this.#initializing = null;
    }
  }

  async refresh(quotes: readonly Quote[], now = this.clock()): Promise<void> {
    await this.initialize(quotes);
    const nowMs = now.getTime();
    const previousMs = this.#lastRefreshAtMs ?? nowMs;
    const elapsedMs = clamp(nowMs - previousMs, 0, DAY_MS);
    const elapsedDays = elapsedMs / DAY_MS;
    let regimesChanged = false;
    let eventsChanged = false;

    for (const [key, regime] of this.#regimes) {
      if (nowMs >= new Date(regime.nextTransitionAt).getTime()) {
        this.#regimes.set(
          key,
          this.#nextRegime(regime.scopeType, regime.scopeKey, regime.phase, now),
        );
        regimesChanged = true;
      }
    }

    if (elapsedDays > 0) {
      for (const state of this.#states.values()) {
        const dailyDrift = companyFundamentalDrift(state);
        state.fundamentalValue = clamp(
          state.fundamentalValue * Math.exp(dailyDrift * elapsedDays),
          0.0001,
          10_000_000,
        );
        state.updatedAt = now.toISOString();
      }
    }

    for (const event of this.#events.values()) {
      const progress = eventFundamentalProgress(event, nowMs);
      const delta = Math.max(0, progress - event.appliedFraction);
      if (delta <= 0) {
        continue;
      }
      for (const state of this.#matchingStates(event)) {
        state.fundamentalValue = clamp(
          state.fundamentalValue *
            Math.exp(event.fundamentalImpact * delta),
          0.0001,
          10_000_000,
        );
        state.updatedAt = now.toISOString();
      }
      event.appliedFraction = progress;
      event.updatedAt = now.toISOString();
      eventsChanged = true;
    }

    if (nowMs >= this.#nextOwnershipRefreshAtMs) {
      this.#refreshOwnership(now);
      this.#nextOwnershipRefreshAtMs = nowMs + OWNERSHIP_REFRESH_MS;
    }

    if (this.automaticEvents && nowMs >= this.#nextAutomaticEventAtMs) {
      const generated = this.#generateAutomaticEvent(now);
      if (generated) {
        this.#events.set(generated.id, generated);
        eventsChanged = true;
      }
      this.#nextAutomaticEventAtMs =
        nowMs +
        AUTOMATIC_EVENT_MINIMUM_INTERVAL_MS +
        this.random() *
          (AUTOMATIC_EVENT_MAXIMUM_INTERVAL_MS -
            AUTOMATIC_EVENT_MINIMUM_INTERVAL_MS);
    }

    this.#refreshEventCaches(nowMs);
    this.#lastRefreshAtMs = nowMs;
    this.#lastRefreshAt = now.toISOString();
    this.#signalSequence += 1;

    if (
      nowMs >= this.#nextPersistenceAtMs ||
      regimesChanged ||
      eventsChanged
    ) {
      await this.#persist();
      this.#nextPersistenceAtMs = nowMs + PERSISTENCE_INTERVAL_MS;
    }
  }

  getSignal(
    instrumentId: string,
    currentPrice: number,
  ): VirtualMarketSignal | undefined {
    const state = this.#states.get(instrumentId);
    const instrument = this.#instrumentById.get(instrumentId);
    if (!state || !instrument) {
      return undefined;
    }
    const marketRegime = this.#regimes.get(`MARKET:${instrument.market}`);
    const sectorRegime = this.#regimes.get(
      `SECTOR:${instrument.market}:${instrument.industry}`,
    );
    const eventSentiment = this.#eventSentiment.get(instrumentId) ?? 0;
    const targetPrice = Math.max(
      0.0001,
      state.fundamentalValue *
        Math.exp(state.ownershipPremium + eventSentiment),
    );
    const safePrice = Math.max(0.0001, currentPrice);
    const fundamentalGap = Math.log(targetPrice / safePrice);
    const marketDriftPerDay = marketRegime?.driftPerDay ?? 0;
    const sectorDriftPerDay =
      (sectorRegime?.driftPerDay ?? 0) * (0.5 + state.cyclicality * 0.8);
    const expectedDailyReturn =
      companyFundamentalDrift(state) +
      marketDriftPerDay +
      sectorDriftPerDay +
      fundamentalGap / FUNDAMENTAL_CONVERGENCE_DAYS;

    return {
      instrumentId,
      fundamentalValue: state.fundamentalValue,
      targetPrice,
      fundamentalGap,
      expectedDailyReturn,
      marketDriftPerDay,
      sectorDriftPerDay,
      ownershipPremium: state.ownershipPremium,
      ownershipConcentration: state.ownershipConcentration,
      eventSentiment,
      volatilityMultiplier: clamp(
        (marketRegime?.volatilityMultiplier ?? 1) *
          (sectorRegime?.volatilityMultiplier ?? 1) *
          (this.#eventVolatility.get(instrumentId) ?? 1),
        0.45,
        3,
      ),
      qualityScore: state.qualityScore,
      growthScore: state.growthScore,
      leverageRisk: state.leverageRisk,
      signalVersion: this.signalVersion,
    };
  }

  get signalVersion(): string {
    return `${this.#lastRefreshAt ?? "uninitialized"}:${this.#signalSequence}`;
  }

  getStatus(now = this.clock()): VirtualMarketStateStatus {
    const nowMs = now.getTime();
    const premiums = [...this.#states.values()].map(
      (state) => state.ownershipPremium,
    );
    const regimeCounts: Record<MarketRegimePhase, number> = {
      BULL: 0,
      NEUTRAL: 0,
      BEAR: 0,
    };
    for (const regime of this.#regimes.values()) {
      regimeCounts[regime.phase] += 1;
    }
    return {
      instrumentCount: this.#states.size,
      activeEventCount: [...this.#events.values()].filter(
        (event) => eventIntensity(event, nowMs) > 0.0001,
      ).length,
      totalEventCount: this.#events.size,
      regimeCounts,
      averageOwnershipPremium:
        premiums.length === 0
          ? 0
          : premiums.reduce((sum, value) => sum + value, 0) /
            premiums.length,
      maximumOwnershipPremium:
        premiums.length === 0 ? 0 : Math.max(...premiums),
      lastRefreshAt: this.#lastRefreshAt,
      signalVersion: this.signalVersion,
    };
  }

  async scheduleEvent(
    input: ScheduleVirtualMarketEventInput,
  ): Promise<VirtualMarketEventRecord> {
    await this.initialize();
    this.#assertScope(input.scopeType, input.scopeKey);
    const startsAt = input.startsAt
      ? new Date(input.startsAt)
      : this.clock();
    if (!Number.isFinite(startsAt.getTime())) {
      throw new Error("INVALID_EVENT_START");
    }
    const durationMs = Math.round(
      clamp(input.durationMs, 60 * 60_000, 30 * DAY_MS),
    );
    const now = this.clock();
    const event: VirtualMarketEventRecord = {
      id: randomUUID(),
      kind: input.kind.trim().slice(0, 80) || "GENERAL",
      scopeType: input.scopeType,
      scopeKey: input.scopeKey,
      headline: input.headline.trim().slice(0, 240) || "模拟市场事件",
      fundamentalImpact: clamp(input.fundamentalImpact, -0.25, 0.25),
      sentimentImpact: clamp(input.sentimentImpact, -0.12, 0.12),
      volatilityMultiplier: clamp(input.volatilityMultiplier ?? 1, 0.5, 3),
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + durationMs).toISOString(),
      decayHalfLifeMs: Math.round(
        clamp(
          input.decayHalfLifeMs,
          60 * 60_000,
          30 * DAY_MS,
        ),
      ),
      appliedFraction: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.#events.set(event.id, event);
    await this.store.saveEvents([event]);
    this.#refreshEventCaches(now.getTime());
    return structuredClone(event);
  }

  listEvents(): VirtualMarketEventRecord[] {
    return [...this.#events.values()]
      .sort((left, right) => right.startsAt.localeCompare(left.startsAt))
      .map((event) => structuredClone(event));
  }

  async #initialize(quotes: readonly Quote[]): Promise<void> {
    const [loadedStates, loadedRegimes, loadedEvents] = await Promise.all([
      this.store.loadInstrumentStates(),
      this.store.loadRegimes(),
      this.store.loadEvents(),
    ]);
    for (const state of loadedStates) {
      if (this.#instrumentById.has(state.instrumentId)) {
        this.#states.set(state.instrumentId, state);
      }
    }
    for (const regime of loadedRegimes) {
      this.#regimes.set(regimeKey(regime.scopeType, regime.scopeKey), regime);
    }
    for (const event of loadedEvents) {
      this.#events.set(event.id, event);
    }

    const quoteById = new Map(quotes.map((quote) => [quote.instrumentId, quote]));
    const now = this.clock();
    for (const instrument of this.#instrumentById.values()) {
      if (!this.#states.has(instrument.id)) {
        this.#states.set(
          instrument.id,
          createInstrumentState(
            instrument,
            quoteById.get(instrument.id)?.currentPrice ?? instrument.initialPrice,
            now,
          ),
        );
      }
      const marketKey = regimeKey("MARKET", instrument.market);
      if (!this.#regimes.has(marketKey)) {
        this.#regimes.set(
          marketKey,
          initialRegime("MARKET", instrument.market, now),
        );
      }
      const sectorScopeKey = `${instrument.market}:${instrument.industry}`;
      const sectorKey = regimeKey("SECTOR", sectorScopeKey);
      if (!this.#regimes.has(sectorKey)) {
        this.#regimes.set(
          sectorKey,
          initialRegime("SECTOR", sectorScopeKey, now),
        );
      }
    }

    this.#lastRefreshAtMs = now.getTime();
    this.#lastRefreshAt = now.toISOString();
    this.#nextOwnershipRefreshAtMs = now.getTime();
    this.#nextPersistenceAtMs = now.getTime() + PERSISTENCE_INTERVAL_MS;
    const latestEventAt = Math.max(
      0,
      ...[...this.#events.values()].map((event) =>
        new Date(event.createdAt).getTime(),
      ),
    );
    this.#nextAutomaticEventAtMs = Math.max(
      now.getTime() + AUTOMATIC_EVENT_MINIMUM_INTERVAL_MS,
      latestEventAt + AUTOMATIC_EVENT_MINIMUM_INTERVAL_MS,
    );
    this.#refreshOwnership(now);
    this.#refreshEventCaches(now.getTime());
    await this.#persist();
  }

  #refreshOwnership(now: Date): void {
    const grouped = new Map<string, OwnershipPositionRecord[]>();
    for (const position of this.repository.listOwnershipPositions()) {
      const positions = grouped.get(position.instrumentId) ?? [];
      positions.push(position);
      grouped.set(position.instrumentId, positions);
    }

    for (const state of this.#states.values()) {
      const positions = grouped.get(state.instrumentId) ?? [];
      let weightedOwnership = 0;
      let rawOwnership = 0;
      let maximumHolderShare = 0;
      for (const position of positions) {
        const share = clamp(position.quantity / state.floatShares, 0, 1);
        const ageDays = position.openedAt
          ? Math.max(
              0,
              (now.getTime() - new Date(position.openedAt).getTime()) /
                DAY_MS,
            )
          : 0;
        const durationWeight = 0.15 + 0.85 * (1 - Math.exp(-ageDays / 3));
        const actorWeight = ownershipActorWeight(position, this.repository);
        weightedOwnership += share * durationWeight * actorWeight;
        rawOwnership += share;
        maximumHolderShare = Math.max(maximumHolderShare, share);
      }
      const convictionPremium = Math.min(
        MAXIMUM_OWNERSHIP_PREMIUM,
        0.25 * Math.sqrt(Math.max(0, weightedOwnership)),
      );
      const concentrationDiscount =
        rawOwnership > 0.35 ? (rawOwnership - 0.35) * 0.08 : 0;
      state.ownershipPremium = clamp(
        convictionPremium - concentrationDiscount,
        -0.04,
        MAXIMUM_OWNERSHIP_PREMIUM,
      );
      state.ownershipConcentration = clamp(maximumHolderShare, 0, 1);
      state.updatedAt = now.toISOString();
    }
  }

  #refreshEventCaches(nowMs: number): void {
    this.#eventSentiment.clear();
    this.#eventVolatility.clear();
    for (const instrumentId of this.#instrumentById.keys()) {
      this.#eventVolatility.set(instrumentId, 1);
    }
    for (const event of this.#events.values()) {
      const intensity = eventIntensity(event, nowMs);
      if (intensity <= 0.000001) {
        continue;
      }
      for (const state of this.#matchingStates(event)) {
        this.#eventSentiment.set(
          state.instrumentId,
          clamp(
            (this.#eventSentiment.get(state.instrumentId) ?? 0) +
              event.sentimentImpact * intensity,
            -0.2,
            0.2,
          ),
        );
        this.#eventVolatility.set(
          state.instrumentId,
          clamp(
            (this.#eventVolatility.get(state.instrumentId) ?? 1) *
              (1 + (event.volatilityMultiplier - 1) * intensity),
            0.5,
            3,
          ),
        );
      }
    }
  }

  #matchingStates(
    event: Pick<VirtualMarketEventRecord, "scopeType" | "scopeKey">,
  ): VirtualInstrumentStateRecord[] {
    if (event.scopeType === "INSTRUMENT") {
      const state = this.#states.get(event.scopeKey);
      return state ? [state] : [];
    }
    return [...this.#states.values()].filter((state) => {
      const instrument = this.#instrumentById.get(state.instrumentId);
      if (!instrument) {
        return false;
      }
      return event.scopeType === "MARKET"
        ? instrument.market === event.scopeKey
        : `${instrument.market}:${instrument.industry}` === event.scopeKey;
    });
  }

  #nextRegime(
    scopeType: "MARKET" | "SECTOR",
    scopeKey: string,
    previousPhase: MarketRegimePhase,
    now: Date,
  ): VirtualMarketRegimeRecord {
    const roll = this.random();
    const phase: MarketRegimePhase =
      previousPhase === "BULL"
        ? roll < 0.48
          ? "BULL"
          : roll < 0.82
            ? "NEUTRAL"
            : "BEAR"
        : previousPhase === "BEAR"
          ? roll < 0.48
            ? "BEAR"
            : roll < 0.82
              ? "NEUTRAL"
              : "BULL"
          : roll < 0.28
            ? "BULL"
            : roll < 0.56
              ? "BEAR"
              : "NEUTRAL";
    return createRegime(scopeType, scopeKey, phase, now, this.random());
  }

  #generateAutomaticEvent(now: Date): VirtualMarketEventRecord | null {
    const instruments = [...this.#instrumentById.values()];
    if (instruments.length === 0) {
      return null;
    }
    const instrument =
      instruments[Math.floor(this.random() * instruments.length)] ??
      instruments[0]!;
    const direction = this.random() < 0.5 ? -1 : 1;
    const scopeRoll = this.random();
    const scopeType: MarketStateScopeType =
      scopeRoll < 0.55
        ? "INSTRUMENT"
        : scopeRoll < 0.82
          ? "SECTOR"
          : "MARKET";
    const scopeKey =
      scopeType === "INSTRUMENT"
        ? instrument.id
        : scopeType === "SECTOR"
          ? `${instrument.market}:${instrument.industry}`
          : instrument.market;
    const durationMs = Math.round((1 + this.random() * 4) * DAY_MS);
    const impactScale = scopeType === "INSTRUMENT" ? 1 : 0.55;
    const event: VirtualMarketEventRecord = {
      id: randomUUID(),
      kind: direction > 0 ? "POSITIVE_CATALYST" : "NEGATIVE_CATALYST",
      scopeType,
      scopeKey,
      headline:
        direction > 0
          ? `${instrument.industry}出现模拟利好催化`
          : `${instrument.industry}出现模拟风险事件`,
      fundamentalImpact:
        direction * impactScale * (0.008 + this.random() * 0.025),
      sentimentImpact:
        direction * impactScale * (0.01 + this.random() * 0.035),
      volatilityMultiplier: 1.15 + this.random() * 0.65,
      startsAt: now.toISOString(),
      endsAt: new Date(now.getTime() + durationMs).toISOString(),
      decayHalfLifeMs: Math.round((1 + this.random() * 5) * DAY_MS),
      appliedFraction: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    return event;
  }

  #assertScope(scopeType: MarketStateScopeType, scopeKey: string): void {
    const valid =
      scopeType === "INSTRUMENT"
        ? this.#instrumentById.has(scopeKey)
        : scopeType === "MARKET"
          ? [...this.#instrumentById.values()].some(
              (instrument) => instrument.market === scopeKey,
            )
          : [...this.#instrumentById.values()].some(
              (instrument) =>
                `${instrument.market}:${instrument.industry}` === scopeKey,
            );
    if (!valid) {
      throw new Error("INVALID_EVENT_SCOPE");
    }
  }

  async #persist(): Promise<void> {
    await Promise.all([
      this.store.saveInstrumentStates([...this.#states.values()]),
      this.store.saveRegimes([...this.#regimes.values()]),
      this.store.saveEvents([...this.#events.values()]),
    ]);
  }
}

function createInstrumentState(
  instrument: InstrumentRecord,
  referencePrice: number,
  now: Date,
): VirtualInstrumentStateRecord {
  const qualityScore = stableUnit(`${instrument.id}:quality`);
  const growthScore = stableUnit(`${instrument.id}:growth`) * 2 - 1;
  const leverageRisk = stableUnit(`${instrument.id}:leverage`);
  const cyclicality = stableUnit(`${instrument.id}:cyclicality`);
  const sourcePrice = instrument.sourceInitialPrice ?? instrument.initialPrice;
  const floatShares = clamp(
    instrument.circulatingMarketCap && sourcePrice > 0
      ? instrument.circulatingMarketCap / sourcePrice
      : instrument.liquidity * 100_000,
    instrument.lotSize * 100_000,
    10_000_000_000_000,
  );
  return {
    instrumentId: instrument.id,
    fundamentalValue: Math.max(0.0001, referencePrice),
    qualityScore,
    growthScore,
    leverageRisk,
    cyclicality,
    floatShares,
    ownershipPremium: 0,
    ownershipConcentration: 0,
    updatedAt: now.toISOString(),
  };
}

function companyFundamentalDrift(state: VirtualInstrumentStateRecord): number {
  return clamp(
    (state.qualityScore - 0.5) * 0.0014 +
      state.growthScore * 0.0018 -
      (state.leverageRisk - 0.5) * 0.0011,
    -0.004,
    0.004,
  );
}

function ownershipActorWeight(
  position: OwnershipPositionRecord,
  repository: GameRepository,
): number {
  if (position.actorKind === "PLAYER") {
    return 1.2;
  }
  const trader = repository.getAITrader(position.actorId);
  const completed = (trader?.winCount ?? 0) + (trader?.lossCount ?? 0);
  const winRate = completed > 0 ? (trader?.winCount ?? 0) / completed : 0.5;
  const credibility = 0.8 + winRate * 0.4;
  if (position.actorKind === "LLM_AI") {
    return 1.05 * credibility;
  }
  const horizonWeight =
    trader?.investmentHorizon === "LONG"
      ? 0.9
      : trader?.investmentHorizon === "SHORT"
        ? 0.3
        : 0.58;
  return horizonWeight * credibility;
}

function initialRegime(
  scopeType: "MARKET" | "SECTOR",
  scopeKey: string,
  now: Date,
): VirtualMarketRegimeRecord {
  const unit = stableUnit(`${scopeType}:${scopeKey}:regime`);
  const phase: MarketRegimePhase =
    unit < 0.34 ? "BEAR" : unit > 0.66 ? "BULL" : "NEUTRAL";
  return createRegime(scopeType, scopeKey, phase, now, unit);
}

function createRegime(
  scopeType: "MARKET" | "SECTOR",
  scopeKey: string,
  phase: MarketRegimePhase,
  now: Date,
  unit: number,
): VirtualMarketRegimeRecord {
  const magnitude = scopeType === "MARKET" ? 0.0026 : 0.0038;
  const driftPerDay =
    phase === "BULL"
      ? magnitude * (0.65 + unit * 0.7)
      : phase === "BEAR"
        ? -magnitude * (0.65 + unit * 0.7)
        : (unit - 0.5) * magnitude * 0.22;
  const durationDays =
    (scopeType === "MARKET" ? 6 : 3) +
    unit * (scopeType === "MARKET" ? 12 : 8);
  return {
    scopeType,
    scopeKey,
    phase,
    driftPerDay,
    volatilityMultiplier:
      phase === "NEUTRAL" ? 0.9 + unit * 0.2 : 1.05 + unit * 0.35,
    startedAt: now.toISOString(),
    nextTransitionAt: new Date(
      now.getTime() + durationDays * DAY_MS,
    ).toISOString(),
    updatedAt: now.toISOString(),
  };
}

function eventFundamentalProgress(
  event: VirtualMarketEventRecord,
  nowMs: number,
): number {
  const startsAt = new Date(event.startsAt).getTime();
  const endsAt = new Date(event.endsAt).getTime();
  if (nowMs <= startsAt) {
    return 0;
  }
  return clamp((nowMs - startsAt) / Math.max(1, endsAt - startsAt), 0, 1);
}

function eventIntensity(event: VirtualMarketEventRecord, nowMs: number): number {
  const startsAt = new Date(event.startsAt).getTime();
  const endsAt = new Date(event.endsAt).getTime();
  if (nowMs < startsAt) {
    return 0;
  }
  if (nowMs <= endsAt) {
    return clamp((nowMs - startsAt) / Math.max(1, endsAt - startsAt), 0, 1);
  }
  return Math.exp(
    (-Math.LN2 * (nowMs - endsAt)) / Math.max(1, event.decayHalfLifeMs),
  );
}

function regimeKey(
  scopeType: "MARKET" | "SECTOR",
  scopeKey: string,
): string {
  return `${scopeType}:${scopeKey}`;
}

function stableUnit(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 4_294_967_295;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
