import type {
  DailyCheckInStatus,
  DisplayCurrency,
  MarketMode,
  RewardClaimResult,
} from "@gupiaomoniqi/shared";
import type { GameRepository } from "../repositories/GameRepository.js";
import { RealTradingService } from "../real-market/RealTradingService.js";
import type { PortfolioService } from "./PortfolioService.js";
import {
  AccountFeatureError,
  AccountFeatureStore,
  type PreparedRewardClaim,
} from "./AccountFeatureStore.js";

export class RewardService {
  constructor(
    private readonly store: AccountFeatureStore,
    private readonly virtualRepository: GameRepository,
    private readonly virtualPortfolioService: PortfolioService,
    private readonly realTradingService: RealTradingService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  getCheckInStatus(accountId: string): Promise<DailyCheckInStatus> {
    return this.store.checkInStatus(
      accountId,
      taipeiDateKey(this.clock()),
    );
  }

  async checkIn(
    accountId: string,
    mode: MarketMode,
    displayCurrency: DisplayCurrency,
  ): Promise<RewardClaimResult> {
    const now = this.clock();
    const claim = await this.store.prepareCheckIn(
      accountId,
      mode,
      taipeiDateKey(now),
      now.toISOString(),
    );
    return this.#applyClaim(claim, displayCurrency);
  }

  async redeemGiftCode(
    accountId: string,
    mode: MarketMode,
    code: string,
    idempotencyKey: string,
    displayCurrency: DisplayCurrency,
  ): Promise<RewardClaimResult> {
    const now = this.clock();
    const claim = await this.store.prepareGiftCode(
      accountId,
      mode,
      code,
      idempotencyKey,
      now.toISOString(),
    );
    return this.#applyClaim(claim, displayCurrency);
  }

  async #applyClaim(
    claim: PreparedRewardClaim,
    displayCurrency: DisplayCurrency,
  ): Promise<RewardClaimResult> {
    if (
      !claim.created &&
      claim.state === "COMPLETED" &&
      !claim.repeatable
    ) {
      throw new AccountFeatureError(
        claim.kind === "CHECK_IN"
          ? "CHECK_IN_ALREADY_CLAIMED"
          : "GIFT_CODE_ALREADY_USED",
        claim.kind === "CHECK_IN"
          ? "今天已经签到过了"
          : "这个礼包码当前账户已经使用过了",
        409,
      );
    }
    const reason =
      claim.kind === "CHECK_IN"
        ? "每日签到奖励"
        : `礼包码 ${claim.giftCode ?? ""}`;
    let portfolio;

    if (claim.mode === "REAL") {
      portfolio = await this.realTradingService.creditAdjustment(
        claim.accountId,
        claim.id,
        claim.amountUsd,
        reason,
        displayCurrency,
      );
    } else {
      await this.virtualRepository.creditCashAdjustment(
        claim.accountId,
        claim.id,
        claim.amountUsd,
        reason,
      );
      portfolio = this.virtualPortfolioService.getSnapshot(
        claim.accountId,
      );
    }

    const completedAt =
      claim.completedAt ?? this.clock().toISOString();
    await this.store.completeRewardClaim(claim.id, completedAt);
    return {
      claimId: claim.id,
      kind: claim.kind,
      mode: claim.mode,
      amountUsd: claim.amountUsd,
      state: "COMPLETED",
      claimedAt: completedAt,
      portfolio,
    };
  }
}

function taipeiDateKey(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
