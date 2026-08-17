import type { InstrumentRecord } from "../src/repositories/GameRepository.js";
import { MemoryGameRepository } from "../src/repositories/MemoryGameRepository.js";
import { AuthService } from "../src/services/AuthService.js";
import { PortfolioService } from "../src/services/PortfolioService.js";
import { TradeService } from "../src/services/TradeService.js";
import { VirtualMarketEngine } from "../src/virtual-market/VirtualMarketEngine.js";

export const TEST_INSTRUMENTS: InstrumentRecord[] = [
  {
    id: "cn-600519",
    symbol: "600519",
    name: "贵州茅台",
    market: "CN",
    sourceCurrency: "CNY",
    quoteCurrency: "CNY",
    type: "STOCK_VIRTUAL",
    industry: "白酒",
    isTradable: true,
    lotSize: 100,
    settlementCycle: "T1",
    initialPrice: 100,
    volatility: 0.0018,
    liquidity: 8_000,
  },
  {
    id: "hk-00700",
    symbol: "00700",
    name: "腾讯控股",
    market: "HK",
    sourceCurrency: "HKD",
    quoteCurrency: "CNY",
    type: "STOCK_VIRTUAL",
    industry: "互联网",
    isTradable: true,
    lotSize: 100,
    settlementCycle: "T0",
    initialPrice: 80,
    volatility: 0.002,
    liquidity: 9_000,
  },
  {
    id: "us-aapl",
    symbol: "AAPL",
    name: "苹果",
    market: "US",
    sourceCurrency: "USD",
    quoteCurrency: "USD",
    type: "STOCK_VIRTUAL",
    industry: "科技",
    isTradable: true,
    lotSize: 1,
    settlementCycle: "T0",
    initialPrice: 120,
    volatility: 0.0017,
    liquidity: 10_000,
  },
  {
    id: "uk-hsba",
    symbol: "HSBA",
    name: "汇丰控股",
    market: "UK",
    sourceCurrency: "GBP",
    quoteCurrency: "USD",
    type: "STOCK_VIRTUAL",
    industry: "银行",
    isTradable: true,
    lotSize: 1,
    settlementCycle: "T0",
    initialPrice: 20,
    volatility: 0.0016,
    liquidity: 7_000,
  },
];

export async function createTestHarness(
  options: {
    random?: () => number;
    registerAccount?: boolean;
    clock?: () => Date;
  } = {},
) {
  const repository = new MemoryGameRepository(TEST_INSTRUMENTS);
  const now = new Date("2026-07-27T12:00:00.000Z");
  const clock = options.clock ?? (() => now);
  const engine = new VirtualMarketEngine(
    repository,
    TEST_INSTRUMENTS,
    options.random ?? (() => 0.5),
    clock,
  );
  await engine.initialize();
  const authService = new AuthService(repository, clock);
  const portfolioService = new PortfolioService(repository);
  const tradeService = new TradeService(
    repository,
    portfolioService,
    clock,
    engine,
  );
  const auth =
    options.registerAccount === false
      ? null
      : await authService.register({
          username: "test_trader",
          email: "test_trader@example.com",
          displayName: "测试交易员",
          password: "ValidPass123",
        });

  return {
    repository,
    engine,
    authService,
    portfolioService,
    tradeService,
    auth,
    accountId: auth?.account.id,
  };
}
