import type {
  DailyCheckInStatus,
  DisplayCurrency,
  MarketMode,
  PortfolioSnapshot,
  PublicAccount,
} from "@gupiaomoniqi/shared";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  claimDailyCheckIn,
  fetchCheckInStatus,
  fetchPortfolio,
  redeemGiftCode,
} from "../api";
import { formatMoney, formatNumber, signedClass } from "../format";

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
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [loading, setLoading] = useState(Boolean(account));
  const [error, setError] = useState<string | null>(null);
  const [checkIn, setCheckIn] = useState<DailyCheckInStatus | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [giftCode, setGiftCode] = useState("");
  const [giftSubmitting, setGiftSubmitting] = useState(false);
  const [giftRequestKey, setGiftRequestKey] = useState(newRequestKey);
  const [rewardNotice, setRewardNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const dataRequestEpochRef = useRef(0);
  const accountContextKey = `${account?.id ?? "anonymous"}:${mode}`;
  const accountContextKeyRef = useRef(accountContextKey);
  accountContextKeyRef.current = accountContextKey;

  useEffect(() => {
    dataRequestEpochRef.current += 1;
    if (!account) {
      setPortfolio(null);
      setCheckIn(null);
      setCheckingIn(false);
      setGiftSubmitting(false);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);
    setCheckingIn(false);
    setGiftSubmitting(false);
    setRewardNotice(null);
    const initialRequestEpoch = ++dataRequestEpochRef.current;

    Promise.all([fetchPortfolio(mode), fetchCheckInStatus()])
      .then(([nextPortfolio, nextCheckIn]) => {
        if (active && initialRequestEpoch === dataRequestEpochRef.current) {
          setPortfolio(nextPortfolio);
          setCheckIn(nextCheckIn);
        }
      })
      .catch((nextError: unknown) => {
        if (active && initialRequestEpoch === dataRequestEpochRef.current) {
          setError(
            nextError instanceof Error ? nextError.message : "资产读取失败",
          );
        }
      })
      .finally(() => {
        if (active && initialRequestEpoch === dataRequestEpochRef.current) {
          setLoading(false);
        }
      });

    let refreshTimer: number | undefined;
    const refreshPortfolio = async () => {
      const refreshRequestEpoch = ++dataRequestEpochRef.current;
      try {
        const nextPortfolio = await fetchPortfolio(mode);
        if (active && refreshRequestEpoch === dataRequestEpochRef.current) {
          setPortfolio(nextPortfolio);
          setLoading(false);
          setError(null);
        }
      } catch {
        // 保留最后一次成功快照，下一轮继续同步。
      } finally {
        if (active) {
          refreshTimer = window.setTimeout(
            () => void refreshPortfolio(),
            5_000,
          );
        }
      }
    };
    refreshTimer = window.setTimeout(
      () => void refreshPortfolio(),
      5_000,
    );

    return () => {
      active = false;
      dataRequestEpochRef.current += 1;
      if (refreshTimer !== undefined) {
        window.clearTimeout(refreshTimer);
      }
    };
  }, [account?.id, mode]);

  async function handleCheckIn() {
    if (!account || checkingIn || checkIn?.claimed) {
      return;
    }
    const operationContext = accountContextKey;
    setCheckingIn(true);
    setRewardNotice(null);
    try {
      const result = await claimDailyCheckIn(mode);
      if (accountContextKeyRef.current !== operationContext) {
        return;
      }
      dataRequestEpochRef.current += 1;
      setPortfolio(result.portfolio);
      setLoading(false);
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
      if (accountContextKeyRef.current === operationContext) {
        setRewardNotice({
          kind: "error",
          text: nextError instanceof Error ? nextError.message : "签到失败",
        });
      }
    } finally {
      if (accountContextKeyRef.current === operationContext) {
        setCheckingIn(false);
      }
    }
  }

  async function handleGiftCode(event: FormEvent) {
    event.preventDefault();
    const code = giftCode.trim();
    if (!account || !code || giftSubmitting) {
      return;
    }
    const operationContext = accountContextKey;
    setGiftSubmitting(true);
    setRewardNotice(null);
    try {
      const result = await redeemGiftCode(mode, code, giftRequestKey);
      if (accountContextKeyRef.current !== operationContext) {
        return;
      }
      dataRequestEpochRef.current += 1;
      setPortfolio(result.portfolio);
      setLoading(false);
      setGiftCode("");
      setGiftRequestKey(newRequestKey());
      setRewardNotice({
        kind: "success",
        text: `礼包领取成功，${formatMoney(result.amountUsd, displayCurrency)} 已进入${modeLabel(result.mode)}`,
      });
    } catch (nextError) {
      if (accountContextKeyRef.current === operationContext) {
        setRewardNotice({
          kind: "error",
          text:
            nextError instanceof Error
              ? nextError.message
              : "礼包码领取失败",
        });
      }
    } finally {
      if (accountContextKeyRef.current === operationContext) {
        setGiftSubmitting(false);
      }
    }
  }

  if (!account) {
    return (
      <main className="page-shell account-page">
        <section className="account-gate">
          <span className="eyebrow">ACCOUNT REQUIRED</span>
          <h1>登录后查看资产与持仓</h1>
          <p>行情始终公开；模拟资金、持仓和收益需要账户。</p>
          <button type="button" onClick={onRequireAuth}>
            注册或登录
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell account-page">
      <section className="account-heading compact-heading">
        <div>
          <span className="eyebrow">ASSETS · {modeLabel(mode)}</span>
          <h1>{account.displayName}的资产</h1>
          <p>当前以{displayCurrency === "USD" ? "美元" : "人民币"}统一显示</p>
        </div>
        <div className="account-identity">
          <span>@{account.username}</span>
          <span>{account.email ?? "尚未绑定找回邮箱"}</span>
          <strong>{modeLabel(mode)}</strong>
        </div>
      </section>

      {error ? <div className="page-error">{error}</div> : null}

      {loading || !portfolio ? (
        <div className="account-loading">正在计算最新资产…</div>
      ) : (
        <>
          <section className="asset-grid">
            <AssetCard
              emphasis
              label="总资产"
              note="现金 + 持仓市值"
              value={formatMoney(portfolio.totalAssetsUsd, displayCurrency)}
            />
            <AssetCard
              label="可用资金"
              note={`冻结 ${formatMoney(portfolio.frozenCashUsd, displayCurrency)}`}
              value={formatMoney(portfolio.availableCashUsd, displayCurrency)}
            />
            <AssetCard
              label="持仓市值"
              note={mode === "REAL" ? "按最新真实价计算" : "按最新模拟价计算"}
              value={formatMoney(portfolio.positionsValueUsd, displayCurrency)}
            />
            <AssetCard
              movement={portfolio.totalProfitLossUsd}
              label="累计收益"
              note={`已实现 ${formatMoney(portfolio.realizedProfitUsd, displayCurrency)}`}
              value={formatMoney(portfolio.totalProfitLossUsd, displayCurrency)}
            />
          </section>

          <section className="account-section positions-primary">
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
                <table className="account-table positions-table">
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
                          <span>{position.market} · {position.symbol}</span>
                        </td>
                        <td>
                          {formatNumber(position.quantity, {
                            maximumFractionDigits: 0,
                          })}
                          <span>可卖 {position.availableQuantity}</span>
                          {position.frozenQuantity > 0 ? (
                            <span>委托冻结 {position.frozenQuantity}</span>
                          ) : null}
                          {position.pendingSettlementQuantity > 0 ? (
                            <span>待结算 {position.pendingSettlementQuantity}</span>
                          ) : null}
                        </td>
                        <td>{formatMoney(position.averageCostUsd, displayCurrency)}</td>
                        <td>{formatMoney(position.currentPriceUsd, displayCurrency)}</td>
                        <td>{formatMoney(position.marketValueUsd, displayCurrency)}</td>
                        <td className={signedClass(position.profitLossUsd)}>
                          <strong>{formatMoney(position.profitLossUsd, displayCurrency)}</strong>
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
        </>
      )}

      <section className="account-rewards compact-rewards">
        <article className="reward-card check-in-card">
          <span className="eyebrow">DAILY CHECK-IN</span>
          <h2>每日签到</h2>
          <p>每天领取一次，奖励进入当前模拟盘。</p>
          <button
            disabled={checkingIn || Boolean(checkIn?.claimed)}
            type="button"
            onClick={() => void handleCheckIn()}
          >
            {checkIn?.claimed
              ? `今日已签到 · ${modeLabel(checkIn.mode ?? mode)}`
              : checkingIn
                ? "正在入账…"
                : "签到领取 US$100,000"}
          </button>
        </article>

        <article className="reward-card gift-card">
          <span className="eyebrow">GIFT CODE</span>
          <h2>礼包码</h2>
          <p>输入礼包码，资金直接进入当前模拟盘。</p>
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
            <button disabled={!giftCode.trim() || giftSubmitting} type="submit">
              {giftSubmitting ? "正在入账…" : "领取"}
            </button>
          </form>
        </article>
      </section>

      {rewardNotice ? (
        <div className={`inline-notice reward-notice ${rewardNotice.kind}`}>
          {rewardNotice.text}
        </div>
      ) : null}
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
