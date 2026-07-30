import { randomUUID } from "node:crypto";
import type {
  DailyCheckInStatus,
  MarketMode,
  RewardClaimState,
  RewardKind,
} from "@gupiaomoniqi/shared";
import type { PGlite } from "@electric-sql/pglite";

export const WATCHLIST_LIMIT = 200;
export const DAILY_CHECK_IN_REWARD_USD = 100_000;

export interface WatchlistRecord {
  accountId: string;
  mode: MarketMode;
  instrumentId: string;
  createdAt: string;
}

export interface PreparedRewardClaim {
  id: string;
  accountId: string;
  kind: RewardKind;
  mode: MarketMode;
  naturalKey: string;
  giftCode: string | null;
  amountUsd: number;
  state: RewardClaimState;
  createdAt: string;
  completedAt: string | null;
  created: boolean;
  repeatable: boolean;
}

export class AccountFeatureError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "AccountFeatureError";
  }
}

export interface AccountFeatureStore {
  listWatchlist(
    accountId: string,
    mode: MarketMode,
  ): Promise<WatchlistRecord[]>;
  addWatchlist(
    accountId: string,
    mode: MarketMode,
    instrumentId: string,
  ): Promise<WatchlistRecord>;
  removeWatchlist(
    accountId: string,
    mode: MarketMode,
    instrumentId: string,
  ): Promise<void>;
  realWatchlistPriorities(): Promise<Map<string, number>>;
  checkInStatus(
    accountId: string,
    date: string,
  ): Promise<DailyCheckInStatus>;
  prepareCheckIn(
    accountId: string,
    mode: MarketMode,
    date: string,
    now: string,
  ): Promise<PreparedRewardClaim>;
  prepareGiftCode(
    accountId: string,
    mode: MarketMode,
    code: string,
    idempotencyKey: string,
    now: string,
  ): Promise<PreparedRewardClaim>;
  completeRewardClaim(
    claimId: string,
    completedAt: string,
  ): Promise<void>;
}

export class DatabaseAccountFeatureStore
  implements AccountFeatureStore
{
  constructor(private readonly client: PGlite) {}

  async listWatchlist(
    accountId: string,
    mode: MarketMode,
  ): Promise<WatchlistRecord[]> {
    const result = await this.client.query<WatchlistRow>(
      `SELECT account_id, mode, instrument_id, created_at
         FROM watchlist_items
        WHERE account_id = $1 AND mode = $2
        ORDER BY created_at DESC`,
      [accountId, mode],
    );
    return result.rows.map(mapWatchlist);
  }

  async addWatchlist(
    accountId: string,
    mode: MarketMode,
    instrumentId: string,
  ): Promise<WatchlistRecord> {
    return this.client.transaction(async (transaction) => {
      const existing = await transaction.query<WatchlistRow>(
        `SELECT account_id, mode, instrument_id, created_at
           FROM watchlist_items
          WHERE account_id = $1 AND mode = $2 AND instrument_id = $3`,
        [accountId, mode, instrumentId],
      );
      if (existing.rows[0]) {
        return mapWatchlist(existing.rows[0]);
      }
      const count = await transaction.query<{ count: number }>(
        `SELECT COUNT(*)::integer AS count
           FROM watchlist_items
          WHERE account_id = $1 AND mode = $2`,
        [accountId, mode],
      );
      if ((count.rows[0]?.count ?? 0) >= WATCHLIST_LIMIT) {
        throw new AccountFeatureError(
          "WATCHLIST_LIMIT_REACHED",
          `每个模拟盘最多添加 ${WATCHLIST_LIMIT} 只自选股`,
        );
      }
      const createdAt = new Date().toISOString();
      await transaction.query(
        `INSERT INTO watchlist_items
           (account_id, mode, instrument_id, created_at)
         VALUES ($1, $2, $3, $4)`,
        [accountId, mode, instrumentId, createdAt],
      );
      return { accountId, mode, instrumentId, createdAt };
    });
  }

  async removeWatchlist(
    accountId: string,
    mode: MarketMode,
    instrumentId: string,
  ): Promise<void> {
    await this.client.query(
      `DELETE FROM watchlist_items
        WHERE account_id = $1 AND mode = $2 AND instrument_id = $3`,
      [accountId, mode, instrumentId],
    );
  }

  async realWatchlistPriorities(): Promise<Map<string, number>> {
    const result = await this.client.query<{
      instrument_id: string;
      watchers: number;
    }>(
      `SELECT instrument_id, COUNT(*)::integer AS watchers
         FROM watchlist_items
        WHERE mode = 'REAL'
        GROUP BY instrument_id`,
    );
    return new Map(
      result.rows.map((row) => [
        row.instrument_id,
        row.watchers * 10_000,
      ]),
    );
  }

  async checkInStatus(
    accountId: string,
    date: string,
  ): Promise<DailyCheckInStatus> {
    const result = await this.client.query<RewardClaimRow>(
      `SELECT id, account_id, kind, mode, natural_key, gift_code,
              amount_usd::float8, state, created_at, completed_at
         FROM reward_claims
        WHERE account_id = $1
          AND kind = 'CHECK_IN'
          AND natural_key = $2`,
      [accountId, `check-in:${date}`],
    );
    const claim = result.rows[0];
    return {
      date,
      claimed: claim?.state === "COMPLETED",
      claimedAt: claim?.completed_at
        ? new Date(claim.completed_at).toISOString()
        : null,
      mode: claim?.mode ?? null,
      rewardUsd: claim?.amount_usd ?? DAILY_CHECK_IN_REWARD_USD,
    };
  }

  async prepareCheckIn(
    accountId: string,
    mode: MarketMode,
    date: string,
    now: string,
  ): Promise<PreparedRewardClaim> {
    return this.#prepareClaim({
      accountId,
      kind: "CHECK_IN",
      mode,
      naturalKey: `check-in:${date}`,
      giftCode: null,
      amountUsd: DAILY_CHECK_IN_REWARD_USD,
      now,
      repeatable: false,
    });
  }

  async prepareGiftCode(
    accountId: string,
    mode: MarketMode,
    inputCode: string,
    idempotencyKey: string,
    now: string,
  ): Promise<PreparedRewardClaim> {
    const code = inputCode.trim();
    const giftResult = await this.client.query<GiftCodeRow>(
      `SELECT code, amount_usd::float8, repeatable, active
         FROM gift_codes
        WHERE code = $1`,
      [code],
    );
    const gift = giftResult.rows[0];
    if (!gift?.active) {
      throw new AccountFeatureError(
        "GIFT_CODE_INVALID",
        "礼包码不存在或已经停用",
        404,
      );
    }
    return this.#prepareClaim({
      accountId,
      kind: "GIFT_CODE",
      mode,
      naturalKey: gift.repeatable
        ? `gift:${gift.code}:${idempotencyKey}`
        : `gift:${gift.code}`,
      giftCode: gift.code,
      amountUsd: gift.amount_usd,
      now,
      repeatable: gift.repeatable,
    });
  }

  async completeRewardClaim(
    claimId: string,
    completedAt: string,
  ): Promise<void> {
    await this.client.query(
      `UPDATE reward_claims
          SET state = 'COMPLETED',
              completed_at = COALESCE(completed_at, $2)
        WHERE id = $1`,
      [claimId, completedAt],
    );
  }

  async #prepareClaim(input: {
    accountId: string;
    kind: RewardKind;
    mode: MarketMode;
    naturalKey: string;
    giftCode: string | null;
    amountUsd: number;
    now: string;
    repeatable: boolean;
  }): Promise<PreparedRewardClaim> {
    return this.client.transaction(async (transaction) => {
      const existing = await transaction.query<RewardClaimRow>(
        `SELECT id, account_id, kind, mode, natural_key, gift_code,
                amount_usd::float8, state, created_at, completed_at
           FROM reward_claims
          WHERE account_id = $1 AND kind = $2 AND natural_key = $3`,
        [input.accountId, input.kind, input.naturalKey],
      );
      if (existing.rows[0]) {
        return {
          ...mapRewardClaim(existing.rows[0]),
          created: false,
          repeatable: input.repeatable,
        };
      }
      const id = randomUUID();
      await transaction.query(
        `INSERT INTO reward_claims (
           id, account_id, kind, mode, natural_key, gift_code,
           amount_usd, state, created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8)`,
        [
          id,
          input.accountId,
          input.kind,
          input.mode,
          input.naturalKey,
          input.giftCode,
          input.amountUsd,
          input.now,
        ],
      );
      return {
        id,
        accountId: input.accountId,
        kind: input.kind,
        mode: input.mode,
        naturalKey: input.naturalKey,
        giftCode: input.giftCode,
        amountUsd: input.amountUsd,
        state: "PENDING",
        createdAt: input.now,
        completedAt: null,
        created: true,
        repeatable: input.repeatable,
      };
    });
  }
}

export class MemoryAccountFeatureStore
  implements AccountFeatureStore
{
  readonly #watchlist = new Map<string, WatchlistRecord>();
  readonly #claims = new Map<string, PreparedRewardClaim>();
  readonly #claimIdsByNaturalKey = new Map<string, string>();
  readonly #giftCodes = new Map<
    string,
    { amountUsd: number; repeatable: boolean; active: boolean }
  >([
    [
      "666666",
      { amountUsd: 100_000, repeatable: false, active: true },
    ],
    [
      "888888",
      { amountUsd: 500_000, repeatable: false, active: true },
    ],
    [
      "#1161125922",
      { amountUsd: 1_000_000, repeatable: true, active: true },
    ],
  ]);

  async listWatchlist(
    accountId: string,
    mode: MarketMode,
  ): Promise<WatchlistRecord[]> {
    return [...this.#watchlist.values()]
      .filter(
        (item) => item.accountId === accountId && item.mode === mode,
      )
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      )
      .map((item) => structuredClone(item));
  }

  async addWatchlist(
    accountId: string,
    mode: MarketMode,
    instrumentId: string,
  ): Promise<WatchlistRecord> {
    const key = watchlistKey(accountId, mode, instrumentId);
    const existing = this.#watchlist.get(key);
    if (existing) {
      return structuredClone(existing);
    }
    const count = (await this.listWatchlist(accountId, mode)).length;
    if (count >= WATCHLIST_LIMIT) {
      throw new AccountFeatureError(
        "WATCHLIST_LIMIT_REACHED",
        `每个模拟盘最多添加 ${WATCHLIST_LIMIT} 只自选股`,
      );
    }
    const record = {
      accountId,
      mode,
      instrumentId,
      createdAt: new Date().toISOString(),
    };
    this.#watchlist.set(key, record);
    return structuredClone(record);
  }

  async removeWatchlist(
    accountId: string,
    mode: MarketMode,
    instrumentId: string,
  ): Promise<void> {
    this.#watchlist.delete(
      watchlistKey(accountId, mode, instrumentId),
    );
  }

  async realWatchlistPriorities(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const item of this.#watchlist.values()) {
      if (item.mode === "REAL") {
        counts.set(
          item.instrumentId,
          (counts.get(item.instrumentId) ?? 0) + 10_000,
        );
      }
    }
    return counts;
  }

  async checkInStatus(
    accountId: string,
    date: string,
  ): Promise<DailyCheckInStatus> {
    const id = this.#claimIdsByNaturalKey.get(
      claimNaturalKey(accountId, "CHECK_IN", `check-in:${date}`),
    );
    const claim = id ? this.#claims.get(id) : undefined;
    return {
      date,
      claimed: claim?.state === "COMPLETED",
      claimedAt: claim?.completedAt ?? null,
      mode: claim?.mode ?? null,
      rewardUsd: claim?.amountUsd ?? DAILY_CHECK_IN_REWARD_USD,
    };
  }

  async prepareCheckIn(
    accountId: string,
    mode: MarketMode,
    date: string,
    now: string,
  ): Promise<PreparedRewardClaim> {
    return this.#prepare({
      accountId,
      kind: "CHECK_IN",
      mode,
      naturalKey: `check-in:${date}`,
      giftCode: null,
      amountUsd: DAILY_CHECK_IN_REWARD_USD,
      now,
      repeatable: false,
    });
  }

  async prepareGiftCode(
    accountId: string,
    mode: MarketMode,
    inputCode: string,
    idempotencyKey: string,
    now: string,
  ): Promise<PreparedRewardClaim> {
    const code = inputCode.trim();
    const gift = this.#giftCodes.get(code);
    if (!gift?.active) {
      throw new AccountFeatureError(
        "GIFT_CODE_INVALID",
        "礼包码不存在或已经停用",
        404,
      );
    }
    return this.#prepare({
      accountId,
      kind: "GIFT_CODE",
      mode,
      naturalKey: gift.repeatable
        ? `gift:${code}:${idempotencyKey}`
        : `gift:${code}`,
      giftCode: code,
      amountUsd: gift.amountUsd,
      now,
      repeatable: gift.repeatable,
    });
  }

  async completeRewardClaim(
    claimId: string,
    completedAt: string,
  ): Promise<void> {
    const claim = this.#claims.get(claimId);
    if (claim) {
      claim.state = "COMPLETED";
      claim.completedAt ??= completedAt;
    }
  }

  #prepare(input: {
    accountId: string;
    kind: RewardKind;
    mode: MarketMode;
    naturalKey: string;
    giftCode: string | null;
    amountUsd: number;
    now: string;
    repeatable: boolean;
  }): PreparedRewardClaim {
    const naturalKey = claimNaturalKey(
      input.accountId,
      input.kind,
      input.naturalKey,
    );
    const existingId = this.#claimIdsByNaturalKey.get(naturalKey);
    if (existingId) {
      const existing = this.#claims.get(existingId);
      if (!existing) {
        throw new Error("MEMORY_REWARD_CLAIM_MISSING");
      }
      return {
        ...structuredClone(existing),
        created: false,
      };
    }
    const claim: PreparedRewardClaim = {
      id: randomUUID(),
      accountId: input.accountId,
      kind: input.kind,
      mode: input.mode,
      naturalKey: input.naturalKey,
      giftCode: input.giftCode,
      amountUsd: input.amountUsd,
      state: "PENDING",
      createdAt: input.now,
      completedAt: null,
      created: true,
      repeatable: input.repeatable,
    };
    this.#claims.set(claim.id, claim);
    this.#claimIdsByNaturalKey.set(naturalKey, claim.id);
    return structuredClone(claim);
  }
}

interface WatchlistRow {
  account_id: string;
  mode: MarketMode;
  instrument_id: string;
  created_at: Date | string;
}

interface GiftCodeRow {
  code: string;
  amount_usd: number;
  repeatable: boolean;
  active: boolean;
}

interface RewardClaimRow {
  id: string;
  account_id: string;
  kind: RewardKind;
  mode: MarketMode;
  natural_key: string;
  gift_code: string | null;
  amount_usd: number;
  state: RewardClaimState;
  created_at: Date | string;
  completed_at: Date | string | null;
}

function mapWatchlist(row: WatchlistRow): WatchlistRecord {
  return {
    accountId: row.account_id,
    mode: row.mode,
    instrumentId: row.instrument_id,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function mapRewardClaim(
  row: RewardClaimRow,
): Omit<PreparedRewardClaim, "created" | "repeatable"> {
  return {
    id: row.id,
    accountId: row.account_id,
    kind: row.kind,
    mode: row.mode,
    naturalKey: row.natural_key,
    giftCode: row.gift_code,
    amountUsd: row.amount_usd,
    state: row.state,
    createdAt: new Date(row.created_at).toISOString(),
    completedAt: row.completed_at
      ? new Date(row.completed_at).toISOString()
      : null,
  };
}

function watchlistKey(
  accountId: string,
  mode: MarketMode,
  instrumentId: string,
): string {
  return `${accountId}:${mode}:${instrumentId}`;
}

function claimNaturalKey(
  accountId: string,
  kind: RewardKind,
  naturalKey: string,
): string {
  return `${accountId}:${kind}:${naturalKey}`;
}
