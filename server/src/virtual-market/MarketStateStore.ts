import type { PGlite } from "@electric-sql/pglite";

export type MarketRegimePhase = "BULL" | "NEUTRAL" | "BEAR";
export type MarketStateScopeType = "MARKET" | "SECTOR" | "INSTRUMENT";

export interface VirtualInstrumentStateRecord {
  instrumentId: string;
  fundamentalValue: number;
  qualityScore: number;
  growthScore: number;
  leverageRisk: number;
  cyclicality: number;
  floatShares: number;
  ownershipPremium: number;
  ownershipConcentration: number;
  updatedAt: string;
}

export interface VirtualMarketRegimeRecord {
  scopeType: "MARKET" | "SECTOR";
  scopeKey: string;
  phase: MarketRegimePhase;
  driftPerDay: number;
  volatilityMultiplier: number;
  startedAt: string;
  nextTransitionAt: string;
  updatedAt: string;
}

export interface VirtualMarketEventRecord {
  id: string;
  kind: string;
  scopeType: MarketStateScopeType;
  scopeKey: string;
  headline: string;
  fundamentalImpact: number;
  sentimentImpact: number;
  volatilityMultiplier: number;
  startsAt: string;
  endsAt: string;
  decayHalfLifeMs: number;
  appliedFraction: number;
  createdAt: string;
  updatedAt: string;
}

export interface VirtualMarketStateStore {
  loadInstrumentStates(): Promise<VirtualInstrumentStateRecord[]>;
  saveInstrumentStates(states: VirtualInstrumentStateRecord[]): Promise<void>;
  loadRegimes(): Promise<VirtualMarketRegimeRecord[]>;
  saveRegimes(regimes: VirtualMarketRegimeRecord[]): Promise<void>;
  loadEvents(): Promise<VirtualMarketEventRecord[]>;
  saveEvents(events: VirtualMarketEventRecord[]): Promise<void>;
}

export class MemoryVirtualMarketStateStore implements VirtualMarketStateStore {
  readonly #instrumentStates = new Map<string, VirtualInstrumentStateRecord>();
  readonly #regimes = new Map<string, VirtualMarketRegimeRecord>();
  readonly #events = new Map<string, VirtualMarketEventRecord>();

  async loadInstrumentStates(): Promise<VirtualInstrumentStateRecord[]> {
    return [...this.#instrumentStates.values()].map((state) =>
      structuredClone(state),
    );
  }

  async saveInstrumentStates(
    states: VirtualInstrumentStateRecord[],
  ): Promise<void> {
    for (const state of states) {
      this.#instrumentStates.set(state.instrumentId, structuredClone(state));
    }
  }

  async loadRegimes(): Promise<VirtualMarketRegimeRecord[]> {
    return [...this.#regimes.values()].map((regime) =>
      structuredClone(regime),
    );
  }

  async saveRegimes(regimes: VirtualMarketRegimeRecord[]): Promise<void> {
    for (const regime of regimes) {
      this.#regimes.set(regimeKey(regime), structuredClone(regime));
    }
  }

  async loadEvents(): Promise<VirtualMarketEventRecord[]> {
    return [...this.#events.values()].map((event) => structuredClone(event));
  }

  async saveEvents(events: VirtualMarketEventRecord[]): Promise<void> {
    for (const event of events) {
      this.#events.set(event.id, structuredClone(event));
    }
  }
}

export class DatabaseVirtualMarketStateStore
  implements VirtualMarketStateStore
{
  constructor(private readonly client: PGlite) {}

  async loadInstrumentStates(): Promise<VirtualInstrumentStateRecord[]> {
    const result = await this.client.query<{
      instrument_id: string;
      fundamental_value: number;
      quality_score: number;
      growth_score: number;
      leverage_risk: number;
      cyclicality: number;
      float_shares: number;
      ownership_premium: number;
      ownership_concentration: number;
      updated_at: Date | string;
    }>(
      `SELECT instrument_id, fundamental_value::float8,
              quality_score::float8, growth_score::float8,
              leverage_risk::float8, cyclicality::float8,
              float_shares::float8, ownership_premium::float8,
              ownership_concentration::float8, updated_at
         FROM virtual_instrument_states`,
    );
    return result.rows.map((row) => ({
      instrumentId: row.instrument_id,
      fundamentalValue: row.fundamental_value,
      qualityScore: row.quality_score,
      growthScore: row.growth_score,
      leverageRisk: row.leverage_risk,
      cyclicality: row.cyclicality,
      floatShares: row.float_shares,
      ownershipPremium: row.ownership_premium,
      ownershipConcentration: row.ownership_concentration,
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }

  async saveInstrumentStates(
    states: VirtualInstrumentStateRecord[],
  ): Promise<void> {
    if (states.length === 0) {
      return;
    }
    await this.client.query(
      `INSERT INTO virtual_instrument_states
         (instrument_id, fundamental_value, quality_score, growth_score,
          leverage_risk, cyclicality, float_shares, ownership_premium,
          ownership_concentration, updated_at)
       SELECT instrument_id, fundamental_value, quality_score, growth_score,
              leverage_risk, cyclicality, float_shares, ownership_premium,
              ownership_concentration, updated_at
         FROM jsonb_to_recordset($1::jsonb) AS state(
           instrument_id text,
           fundamental_value numeric,
           quality_score numeric,
           growth_score numeric,
           leverage_risk numeric,
           cyclicality numeric,
           float_shares numeric,
           ownership_premium numeric,
           ownership_concentration numeric,
           updated_at timestamptz
         )
       ON CONFLICT (instrument_id) DO UPDATE SET
         fundamental_value = excluded.fundamental_value,
         quality_score = excluded.quality_score,
         growth_score = excluded.growth_score,
         leverage_risk = excluded.leverage_risk,
         cyclicality = excluded.cyclicality,
         float_shares = excluded.float_shares,
         ownership_premium = excluded.ownership_premium,
         ownership_concentration = excluded.ownership_concentration,
         updated_at = excluded.updated_at`,
      [
        JSON.stringify(
          states.map((state) => ({
            instrument_id: state.instrumentId,
            fundamental_value: state.fundamentalValue,
            quality_score: state.qualityScore,
            growth_score: state.growthScore,
            leverage_risk: state.leverageRisk,
            cyclicality: state.cyclicality,
            float_shares: state.floatShares,
            ownership_premium: state.ownershipPremium,
            ownership_concentration: state.ownershipConcentration,
            updated_at: state.updatedAt,
          })),
        ),
      ],
    );
  }

  async loadRegimes(): Promise<VirtualMarketRegimeRecord[]> {
    const result = await this.client.query<{
      scope_type: "MARKET" | "SECTOR";
      scope_key: string;
      phase: MarketRegimePhase;
      drift_per_day: number;
      volatility_multiplier: number;
      started_at: Date | string;
      next_transition_at: Date | string;
      updated_at: Date | string;
    }>(
      `SELECT scope_type, scope_key, phase, drift_per_day::float8,
              volatility_multiplier::float8, started_at,
              next_transition_at, updated_at
         FROM virtual_market_regimes`,
    );
    return result.rows.map((row) => ({
      scopeType: row.scope_type,
      scopeKey: row.scope_key,
      phase: row.phase,
      driftPerDay: row.drift_per_day,
      volatilityMultiplier: row.volatility_multiplier,
      startedAt: new Date(row.started_at).toISOString(),
      nextTransitionAt: new Date(row.next_transition_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }

  async saveRegimes(regimes: VirtualMarketRegimeRecord[]): Promise<void> {
    if (regimes.length === 0) {
      return;
    }
    await this.client.query(
      `INSERT INTO virtual_market_regimes
         (scope_type, scope_key, phase, drift_per_day,
          volatility_multiplier, started_at, next_transition_at, updated_at)
       SELECT scope_type, scope_key, phase, drift_per_day,
              volatility_multiplier, started_at, next_transition_at, updated_at
         FROM jsonb_to_recordset($1::jsonb) AS regime(
           scope_type text,
           scope_key text,
           phase text,
           drift_per_day numeric,
           volatility_multiplier numeric,
           started_at timestamptz,
           next_transition_at timestamptz,
           updated_at timestamptz
         )
       ON CONFLICT (scope_type, scope_key) DO UPDATE SET
         phase = excluded.phase,
         drift_per_day = excluded.drift_per_day,
         volatility_multiplier = excluded.volatility_multiplier,
         started_at = excluded.started_at,
         next_transition_at = excluded.next_transition_at,
         updated_at = excluded.updated_at`,
      [
        JSON.stringify(
          regimes.map((regime) => ({
            scope_type: regime.scopeType,
            scope_key: regime.scopeKey,
            phase: regime.phase,
            drift_per_day: regime.driftPerDay,
            volatility_multiplier: regime.volatilityMultiplier,
            started_at: regime.startedAt,
            next_transition_at: regime.nextTransitionAt,
            updated_at: regime.updatedAt,
          })),
        ),
      ],
    );
  }

  async loadEvents(): Promise<VirtualMarketEventRecord[]> {
    const result = await this.client.query<{
      id: string;
      kind: string;
      scope_type: MarketStateScopeType;
      scope_key: string;
      headline: string;
      fundamental_impact: number;
      sentiment_impact: number;
      volatility_multiplier: number;
      starts_at: Date | string;
      ends_at: Date | string;
      decay_half_life_ms: number;
      applied_fraction: number;
      created_at: Date | string;
      updated_at: Date | string;
    }>(
      `SELECT id, kind, scope_type, scope_key, headline,
              fundamental_impact::float8, sentiment_impact::float8,
              volatility_multiplier::float8, starts_at, ends_at,
              decay_half_life_ms::float8, applied_fraction::float8,
              created_at, updated_at
         FROM virtual_market_events`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      scopeType: row.scope_type,
      scopeKey: row.scope_key,
      headline: row.headline,
      fundamentalImpact: row.fundamental_impact,
      sentimentImpact: row.sentiment_impact,
      volatilityMultiplier: row.volatility_multiplier,
      startsAt: new Date(row.starts_at).toISOString(),
      endsAt: new Date(row.ends_at).toISOString(),
      decayHalfLifeMs: row.decay_half_life_ms,
      appliedFraction: row.applied_fraction,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }

  async saveEvents(events: VirtualMarketEventRecord[]): Promise<void> {
    if (events.length === 0) {
      return;
    }
    await this.client.query(
      `INSERT INTO virtual_market_events
         (id, kind, scope_type, scope_key, headline, fundamental_impact,
          sentiment_impact, volatility_multiplier, starts_at, ends_at,
          decay_half_life_ms, applied_fraction, created_at, updated_at)
       SELECT id, kind, scope_type, scope_key, headline, fundamental_impact,
              sentiment_impact, volatility_multiplier, starts_at, ends_at,
              decay_half_life_ms, applied_fraction, created_at, updated_at
         FROM jsonb_to_recordset($1::jsonb) AS event(
           id uuid,
           kind text,
           scope_type text,
           scope_key text,
           headline text,
           fundamental_impact numeric,
           sentiment_impact numeric,
           volatility_multiplier numeric,
           starts_at timestamptz,
           ends_at timestamptz,
           decay_half_life_ms bigint,
           applied_fraction numeric,
           created_at timestamptz,
           updated_at timestamptz
         )
       ON CONFLICT (id) DO UPDATE SET
         applied_fraction = excluded.applied_fraction,
         updated_at = excluded.updated_at`,
      [
        JSON.stringify(
          events.map((event) => ({
            id: event.id,
            kind: event.kind,
            scope_type: event.scopeType,
            scope_key: event.scopeKey,
            headline: event.headline,
            fundamental_impact: event.fundamentalImpact,
            sentiment_impact: event.sentimentImpact,
            volatility_multiplier: event.volatilityMultiplier,
            starts_at: event.startsAt,
            ends_at: event.endsAt,
            decay_half_life_ms: event.decayHalfLifeMs,
            applied_fraction: event.appliedFraction,
            created_at: event.createdAt,
            updated_at: event.updatedAt,
          })),
        ),
      ],
    );
  }
}

function regimeKey(regime: VirtualMarketRegimeRecord): string {
  return `${regime.scopeType}:${regime.scopeKey}`;
}
