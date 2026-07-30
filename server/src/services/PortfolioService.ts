import {
  quotePriceToUsd,
  USD_CNY_DISPLAY_RATE,
  type PortfolioSnapshot,
  type Position,
} from "@gupiaomoniqi/shared";
import {
  roundMoney,
  roundPercent,
  roundUnitPrice,
} from "../domain/money.js";
import type { GameRepository } from "../repositories/GameRepository.js";

export class PortfolioService {
  constructor(private readonly repository: GameRepository) {}

  getSnapshot(accountId: string): PortfolioSnapshot {
    const account = this.repository.getAccountById(accountId);
    const portfolio = this.repository.getPortfolioByAccountId(accountId);

    if (!account || !portfolio) {
      throw new Error("ACCOUNT_PORTFOLIO_NOT_FOUND");
    }

    const positions = this.repository
      .listPositions(portfolio.id)
      .map((record): Position | null => {
        const instrument = this.repository.getInstrumentById(
          record.instrumentId,
        );
        const quote = this.repository.getQuote(record.instrumentId);

        if (!instrument || !quote) {
          return null;
        }

        const currentPriceUsd = roundUnitPrice(
          quotePriceToUsd(quote.currentPrice, quote.quoteCurrency),
        );
        const marketValueUsd = roundMoney(
          record.quantity * currentPriceUsd,
        );
        const costUsd = roundMoney(
          record.quantity * record.averageCostUsd,
        );
        const profitLossUsd = roundMoney(marketValueUsd - costUsd);

        return {
          instrumentId: record.instrumentId,
          symbol: instrument.symbol,
          name: instrument.name,
          market: instrument.market,
          quoteCurrency: instrument.quoteCurrency,
          quantity: record.quantity,
          availableQuantity: record.availableQuantity,
          frozenQuantity: record.frozenQuantity,
          pendingSettlementQuantity: Math.max(
            0,
            record.quantity -
              record.availableQuantity -
              record.frozenQuantity,
          ),
          averageCostUsd: record.averageCostUsd,
          currentPriceUsd,
          marketValueUsd,
          profitLossUsd,
          profitLossPercent:
            costUsd === 0
              ? 0
              : roundPercent((profitLossUsd / costUsd) * 100),
        };
      })
      .filter((position): position is Position => position !== null)
      .sort((left, right) => right.marketValueUsd - left.marketValueUsd);

    const positionsValueUsd = roundMoney(
      positions.reduce(
        (total, position) => total + position.marketValueUsd,
        0,
      ),
    );
    const unrealizedProfitUsd = roundMoney(
      positions.reduce(
        (total, position) => total + position.profitLossUsd,
        0,
      ),
    );
    const realizedProfitUsd = roundMoney(
      this.repository
        .listTransactions(portfolio.id)
        .reduce(
          (total, transaction) =>
            total + (transaction.realizedProfitUsd ?? 0),
          0,
        ),
    );
    const totalAssetsUsd = roundMoney(
      portfolio.availableCashUsd +
        portfolio.frozenCashUsd +
        positionsValueUsd,
    );

    return {
      mode: "VIRTUAL",
      displayCurrency: account.displayCurrency,
      usdCnyRate: USD_CNY_DISPLAY_RATE,
      initialCashUsd: portfolio.initialCashUsd,
      availableCashUsd: portfolio.availableCashUsd,
      frozenCashUsd: portfolio.frozenCashUsd,
      positionsValueUsd,
      totalAssetsUsd,
      realizedProfitUsd,
      unrealizedProfitUsd,
      totalProfitLossUsd: roundMoney(
        totalAssetsUsd - portfolio.initialCashUsd,
      ),
      positions,
    };
  }
}
