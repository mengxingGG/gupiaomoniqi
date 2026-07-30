import type {
  DailyCheckInStatus,
  DisplayCurrency,
  MarketMode,
  PortfolioSnapshot,
  PublicAccount,
  Transaction,
} from "@gupiaomoniqi/shared";
import { type FormEvent, useEffect, useState } from "react";
import {
  claimDailyCheckIn,
  fetchCheckInStatus,
  fetchPortfolio,
  fetchTransactions,
  redeemGiftCode,
} from "../api";
import {
  formatMoney,
  formatNumber,
  signedClass,
} from "../format";

interface AccountPageProps {
  account: PublicAccount | null;
  displayCurrency: DisplayCurrency;
  mode: MarketMode;
  onRequireAuth: () => void;
  onOpenStock: (instrumentId: string) => void;
}

export function AccountPage({
  account,
  displayCurrency,
  mode,
  onRequireAuth,
  onOpenStock,
}: AccountPageProps) {
  const [portfolio, setPortfolio] =
    useState<PortfolioSnapshot | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(Boolean(account));
  const [error, setError] = useState<string | null>(null);
  const [checkIn, setCheckIn] =
    useState<DailyCheckInStatus | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [giftCode, setGiftCode] = useState("");
  const [giftSubmitting, setGiftSubmitting] = useState(false);
  const [giftRequestKey, setGiftRequestKey] = useState(newRequestKey);
  const [rewardNotice, setRewardNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!account) {
      setPortfolio(null);
      setTransactions([]);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    Promise.all([
      fetchPortfolio(mode),
      fetchTransactions(mode),
      fetchCheckInStatus(),
    ])
      .then(([nextPortfolio, nextTransactions, nextCheckIn]) => {
        if (active) {
          setPortfolio(nextPortfolio);
          setTransactions(nextTransactions);
          setCheckIn(nextCheckIn);
        }
      })
      .catch((nextError: unknown) => {
        if (active) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "账户读取失败",
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [account, mode]);

  async function handleCheckIn() {
    if (!account || checkingIn || checkIn?.claimed) {
      return;
    }
    setCheckingIn(true);
    setRewardNotice(null);
    try {
      const result = await claimDailyCheckIn(mode);
      setPortfolio(result.portfolio);
      setCheckIn({
        date: new Date().toISOString().slice(0, 10),
        claimed: true,
        claimedAt: result.claimedAt,
        mode: result.mode,
        rewardUsd: result.amountUsd,
      });
      setRewardNotice({
        kind: "success",
        text: `签到成功，${formatMoney(result.amountUsd, displayCurrency)} 已进入${modeLabel(result.mode)}`,
      });
    } catch (nextError) {
      setRewardNotice({
        kind: "error",
        text:
          nextError instanceof Error
            ? nextError.message
            : "签到失败",
      });
    } finally {
      setCheckingIn(false);
    }
  }

  async function handleGiftCode(event: FormEvent) {
    event.preventDefault();
    const code = giftCode.trim();
    if (!account || !code || giftSubmitting) {
      return;
    }
    setGiftSubmitting(true);
    setRewardNotice(null);
    try {
      const result = await redeemGiftCode(
        mode,
        code,
        giftRequestKey,
      );
      setPortfolio(result.portfolio);
      setGiftCode("");
      setGiftRequestKey(newRequestKey());
      setRewardNotice({
        kind: "success",
        text: `礼包领取成功，${formatMoney(result.amountUsd, displayCurrency)} 已进入${modeLabel(result.mode)}`,
      });
    } catch (nextError) {
      setRewardNotice({
        kind: "error",
        text:
          nextError instanceof Error
            ? nextError.message
            : "礼包码领取失败",
      });
    } finally {
      setGiftSubmitting(false);
    }
  }

  if (!account) {
    return (
      <main className="page-shell account-page">
        <section className="account-gate">
          <span className="eyebrow">ACCOUNT REQUIRED</span>
          <h1>注册后，资产与交易都在这里。</h1>
          <p>
            行情始终公开；只有模拟下单、持仓与成交记录需要账户。
          </p>
          <button type="button" onClick={onRequireAuth}>
            注册或登录
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell account-page">
      <section className="account-heading">
        <div>
          <span className="eyebrow">
            {mode === "REAL"
              ? "REAL DATA PAPER ACCOUNT · SEPARATE DATABASE"
              : "VIRTUAL ACCOUNT · SEPARATE DATABASE"}
          </span>
          <h1>
            {account.displayName}的
            {mode === "REAL" ? "真实行情模拟账户" : "虚拟市场账户"}
          </h1>
          <p>
            与另一模拟盘共用登录身份，但现金、持仓与成交完全隔离。底层按美元记账，
            当前以{displayCurrency === "USD" ? "美元" : "人民币"}显示。
          </p>
        </div>
        <div className="account-identity">
          <span>@{account.username}</span>
          <strong>{modeLabel(mode)}</strong>
        </div>
      </section>

      {error ? <div className="page-error">{error}</div> : null}

      <section className="account-rewards">
        <article className="reward-card check-in-card">
          <span className="eyebrow">DAILY CHECK-IN</span>
          <h2>每日签到</h2>
          <p>
            每个登录账户每天只能领取一次，奖励进入当前打开的模拟盘。
          </p>
          <button
            disabled={checkingIn || Boolean(checkIn?.claimed)}
            type="button"
            onClick={() => void handleCheckIn()}
          >
            {checkIn?.claimed
              ? `今日已签到 · 已进入${modeLabel(checkIn.mode ?? mode)}`
              : checkingIn
                ? "正在入账…"
                : "签到领取 US$100,000"}
          </button>
        </article>

        <article className="reward-card gift-card">
          <span className="eyebrow">GIFT CODE</span>
          <h2>礼包码</h2>
          <p>
            普通礼包每账户每码一次；开发者特权礼包可重复领取。
          </p>
          <form onSubmit={handleGiftCode}>
            <input
              aria-label="礼包码"
              autoComplete="off"
              placeholder="输入礼包码"
              value={giftCode}
              onChange={(event) => {
                setGiftCode(event.target.value);
                setGiftRequestKey(newRequestKey());
                setRewardNotice(null);
              }}
            />
            <button
              disabled={!giftCode.trim() || giftSubmitting}
              type="submit"
            >
              {giftSubmitting ? "正在入账…" : "领取到当前模拟盘"}
            </button>
          </form>
        </article>
      </section>

      {rewardNotice ? (
        <div className={`inline-notice reward-notice ${rewardNotice.kind}`}>
          {rewardNotice.text}
        </div>
      ) : null}

      {loading || !portfolio ? (
        <div className="account-loading">正在计算最新资产…</div>
      ) : (
        <>
          <section className="asset-grid">
            <AssetCard
              emphasis
              label="总资产"
              note="现金 + 持仓市值"
              value={formatMoney(
                portfolio.totalAssetsUsd,
                displayCurrency,
              )}
            />
            <AssetCard
              label="可用资金"
              note="实时可用于市价交易"
              value={formatMoney(
                portfolio.availableCashUsd,
                displayCurrency,
              )}
            />
            <AssetCard
              label="持仓市值"
              note={
                mode === "REAL"
                  ? "按数据库最新真实价计算"
                  : "按最新模拟价计算"
              }
              value={formatMoney(
                portfolio.positionsValueUsd,
                displayCurrency,
              )}
            />
            <AssetCard
              movement={portfolio.totalProfitLossUsd}
              label="累计收益"
              note={`已实现 ${formatMoney(portfolio.realizedProfitUsd, displayCurrency)}`}
              value={formatMoney(
                portfolio.totalProfitLossUsd,
                displayCurrency,
              )}
            />
          </section>

          <section className="account-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">POSITIONS</span>
                <h2>当前持仓</h2>
              </div>
              <span>{portfolio.positions.length} 个标的</span>
            </div>

            {portfolio.positions.length === 0 ? (
              <div className="section-empty">
                <strong>还没有持仓</strong>
                <span>从行情页打开任意股票即可开始模拟交易。</span>
              </div>
            ) : (
              <div className="account-table-wrap">
                <table className="account-table">
                  <thead>
                    <tr>
                      <th>股票</th>
                      <th>持仓 / 可卖</th>
                      <th>成本价</th>
                      <th>{mode === "REAL" ? "最新真实价" : "模拟现价"}</th>
                      <th>市值</th>
                      <th>浮动盈亏</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.positions.map((position) => (
                      <tr
                        key={position.instrumentId}
                        onClick={() => onOpenStock(position.instrumentId)}
                      >
                        <td>
                          <strong>{position.name}</strong>
                          <span>
                            {position.market} · {position.symbol}
                          </span>
                        </td>
                        <td>
                          {formatNumber(position.quantity, {
                            maximumFractionDigits: 0,
                          })}
                          <span>可卖 {position.availableQuantity}</span>
                          {position.pendingSettlementQuantity > 0 ? (
                            <span>
                              待结算{" "}
                              {position.pendingSettlementQuantity}
                            </span>
                          ) : null}
                        </td>
                        <td>
                          {formatMoney(
                            position.averageCostUsd,
                            displayCurrency,
                          )}
                        </td>
                        <td>
                          {formatMoney(
                            position.currentPriceUsd,
                            displayCurrency,
                          )}
                        </td>
                        <td>
                          {formatMoney(
                            position.marketValueUsd,
                            displayCurrency,
                          )}
                        </td>
                        <td className={signedClass(position.profitLossUsd)}>
                          <strong>
                            {formatMoney(
                              position.profitLossUsd,
                              displayCurrency,
                            )}
                          </strong>
                          <span>
                            {position.profitLossPercent > 0 ? "+" : ""}
                            {position.profitLossPercent.toFixed(2)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="account-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">TRANSACTIONS</span>
                <h2>成交记录</h2>
              </div>
              <span>
                {mode === "REAL"
                  ? "保存在独立真实行情模拟数据库"
                  : "保存在虚拟市场数据库"}
              </span>
            </div>

            {transactions.length === 0 ? (
              <div className="section-empty">
                <strong>暂无成交</strong>
                <span>买入或卖出后，流水会立即出现在这里。</span>
              </div>
            ) : (
              <div className="account-table-wrap">
                <table className="account-table transaction-table">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>股票</th>
                      <th>方向</th>
                      <th>数量</th>
                      <th>成交价</th>
                      <th>成交净额</th>
                      <th>已实现盈亏</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((transaction) => (
                      <tr
                        key={transaction.id}
                        onClick={() =>
                          onOpenStock(transaction.instrumentId)
                        }
                      >
                        <td>
                          {new Date(transaction.createdAt).toLocaleString(
                            "zh-CN",
                            {
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false,
                            },
                          )}
                        </td>
                        <td>
                          <strong>{transaction.name}</strong>
                          <span>{transaction.symbol}</span>
                        </td>
                        <td>
                          <span
                            className={`trade-direction ${transaction.side.toLowerCase()}`}
                          >
                            {transaction.side === "BUY" ? "买入" : "卖出"}
                          </span>
                        </td>
                        <td>{transaction.quantity} 股</td>
                        <td>
                          {formatMoney(
                            transaction.priceUsd,
                            displayCurrency,
                          )}
                        </td>
                        <td>
                          {formatMoney(
                            transaction.netAmountUsd,
                            displayCurrency,
                          )}
                        </td>
                        <td
                          className={signedClass(
                            transaction.realizedProfitUsd ?? 0,
                          )}
                        >
                          {transaction.realizedProfitUsd === null
                            ? "—"
                            : formatMoney(
                                transaction.realizedProfitUsd,
                                displayCurrency,
                              )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function AssetCard({
  label,
  value,
  note,
  emphasis = false,
  movement,
}: {
  label: string;
  value: string;
  note: string;
  emphasis?: boolean;
  movement?: number;
}) {
  return (
    <article className={`asset-card ${emphasis ? "emphasis" : ""}`}>
      <span>{label}</span>
      <strong className={movement === undefined ? "" : signedClass(movement)}>
        {value}
      </strong>
      <small>{note}</small>
    </article>
  );
}

function modeLabel(mode: MarketMode): string {
  return mode === "REAL" ? "真实行情模拟盘" : "虚拟市场模拟盘";
}

function newRequestKey(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
