import type {
  AuthResult,
  DisplayCurrency,
  MarketMode,
  PublicAccount,
} from "@gupiaomoniqi/shared";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  fetchCurrentAccount,
  logout,
  readStoredAuth,
  storeAuth,
  updateDisplayCurrency,
} from "./api";
import { AccountPage } from "./pages/AccountPage";
import { EmailCompletionCard } from "./components/EmailCompletionCard";
import { AuthPage } from "./pages/AuthPage";
import { HomePage } from "./pages/HomePage";
import { OrdersPage, type OrdersTab } from "./pages/OrdersPage";
import { StockPage } from "./pages/StockPage";
import type { ConnectionState } from "./useQuoteSocket";

type Route =
  | { page: "home"; mode: MarketMode }
  | { page: "stock"; mode: MarketMode; instrumentId: string }
  | { page: "account"; mode: MarketMode }
  | { page: "orders"; mode: MarketMode; tab: OrdersTab }
  | { page: "auth"; mode: MarketMode };

const DISPLAY_CURRENCY_KEY = "stock-simulator-display-currency";

export function App() {
  const storedAuth = useMemo(() => readStoredAuth(), []);
  const [route, setRoute] = useState<Route>(() =>
    parseRoute(window.location.pathname),
  );
  const [account, setAccount] = useState<PublicAccount | null>(
    storedAuth?.account ?? null,
  );
  const [accountVerified, setAccountVerified] = useState(!storedAuth);
  const [displayCurrency, setDisplayCurrency] =
    useState<DisplayCurrency>(() => {
      if (storedAuth?.account.displayCurrency) {
        return storedAuth.account.displayCurrency;
      }

      const saved = window.localStorage.getItem(DISPLAY_CURRENCY_KEY);
      return saved === "CNY" || saved === "USD" ? saved : "USD";
    });
  const [currencyUpdating, setCurrencyUpdating] = useState(false);
  const [connection, setConnection] =
    useState<ConnectionState>("connecting");
  const [returnPath, setReturnPath] = useState("/");
  const mode = route.mode;

  const navigate = useCallback((path: string) => {
    window.history.pushState({}, "", path);
    setRoute(parseRoute(path));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const handleConnectionChange = useCallback(
    (nextConnection: ConnectionState) => {
      setConnection(nextConnection);
    },
    [],
  );

  useEffect(() => {
    const handlePopState = () =>
      setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const handleExpired = () => {
      setAccount(null);
      setAccountVerified(true);
    };
    window.addEventListener("simulator:auth-expired", handleExpired);
    return () =>
      window.removeEventListener("simulator:auth-expired", handleExpired);
  }, []);

  useEffect(() => {
    if (!storedAuth) {
      return;
    }

    let active = true;
    fetchCurrentAccount()
      .then((currentAccount) => {
        if (!active) {
          return;
        }

        setAccount(currentAccount);
        setAccountVerified(true);
        setDisplayCurrency(currentAccount.displayCurrency);
        storeAuth({
          token: readStoredAuth()?.token ?? storedAuth.token,
          account: currentAccount,
        });
      })
      .catch(() => {
        if (active) {
          setAccount(null);
          setAccountVerified(true);
        }
      });

    return () => {
      active = false;
    };
  }, [storedAuth]);

  const requireAuth = useCallback(() => {
    setReturnPath(window.location.pathname);
    navigate(mode === "REAL" ? "/real/auth" : "/auth");
  }, [mode, navigate]);

  function handleAuthenticated(result: AuthResult) {
    storeAuth(result);
    setAccount(result.account);
    setAccountVerified(true);
    setDisplayCurrency(result.account.displayCurrency);
    window.localStorage.setItem(
      DISPLAY_CURRENCY_KEY,
      result.account.displayCurrency,
    );
    navigate(
      returnPath === "/auth" || returnPath === "/real/auth"
        ? modeRoot(mode)
        : returnPath,
    );
  }

  async function handleCurrencyChange(currency: DisplayCurrency) {
    if (currency === displayCurrency || currencyUpdating) {
      return;
    }

    const previous = displayCurrency;
    setDisplayCurrency(currency);
    window.localStorage.setItem(DISPLAY_CURRENCY_KEY, currency);

    if (!account) {
      return;
    }

    setCurrencyUpdating(true);

    try {
      const nextAccount = await updateDisplayCurrency(currency);
      const auth = readStoredAuth();
      setAccount(nextAccount);

      if (auth) {
        storeAuth({ ...auth, account: nextAccount });
      }
    } catch {
      setDisplayCurrency(previous);
      window.localStorage.setItem(DISPLAY_CURRENCY_KEY, previous);
    } finally {
      setCurrencyUpdating(false);
    }
  }

  async function handleLogout() {
    await logout();
    setAccount(null);
    setAccountVerified(true);
    navigate(modeRoot(mode));
  }

  function handleEmailCompleted(nextAccount: PublicAccount) {
    const auth = readStoredAuth();
    setAccount(nextAccount);
    if (auth) {
      storeAuth({ ...auth, account: nextAccount });
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="brand"
          type="button"
          onClick={() => navigate(modeRoot(mode))}
        >
          <span className="brand-mark">盘</span>
          <span>
            <strong>四海模拟盘</strong>
            <small>Virtual Markets Lab</small>
          </span>
        </button>

        <nav className="main-nav" aria-label="主导航">
          <button
            className={route.page === "home" ? "active" : ""}
            type="button"
            onClick={() => navigate(modeRoot(mode))}
          >
            行情
          </button>
          <button
            className={route.page === "account" ? "active" : ""}
            type="button"
            onClick={() => navigate(accountPath(mode))}
          >
            资产
          </button>
          <button
            className={route.page === "orders" ? "active" : ""}
            type="button"
            onClick={() => navigate(ordersPath(mode, "ORDERS"))}
          >
            订单
          </button>
        </nav>

        <div className="header-actions">
          <div className="market-mode-switch" aria-label="切换模拟盘">
            <button
              className={mode === "VIRTUAL" ? "active" : ""}
              type="button"
              onClick={() => navigate("/")}
            >
              虚拟市场
            </button>
            <button
              className={mode === "REAL" ? "active" : ""}
              type="button"
              onClick={() => navigate("/real")}
            >
              真实行情
            </button>
          </div>
          <div
            className="connection-pill"
            data-state={connection}
            title={
              mode === "REAL"
                ? "东方财富真实行情连接状态"
                : "虚拟行情 WebSocket 状态"
            }
          >
            <span />
            {connection === "live"
              ? mode === "REAL"
                ? "真实行情已连接"
                : "行情已连接"
              : connection === "connecting"
                ? "连接中"
                : "等待重连"}
          </div>

          <div className="currency-switch" aria-label="统一显示币种">
            <button
              className={displayCurrency === "CNY" ? "active" : ""}
              disabled={currencyUpdating}
              type="button"
              onClick={() => void handleCurrencyChange("CNY")}
            >
              CNY
            </button>
            <button
              className={displayCurrency === "USD" ? "active" : ""}
              disabled={currencyUpdating}
              type="button"
              onClick={() => void handleCurrencyChange("USD")}
            >
              USD
            </button>
          </div>

          {account ? (
            <div className="account-menu">
              <button
                className="account-button"
                type="button"
                onClick={() => navigate(accountPath(mode))}
              >
                <span>{account.displayName.slice(0, 1).toUpperCase()}</span>
                <strong>{account.displayName}</strong>
              </button>
              <button
                className="logout-button"
                type="button"
                onClick={() => void handleLogout()}
              >
                退出
              </button>
            </div>
          ) : (
            <button className="login-button" type="button" onClick={requireAuth}>
              注册 / 登录
            </button>
          )}
        </div>
      </header>

      <nav className="mobile-main-nav" aria-label="移动端主导航">
        <button
          className={route.page === "home" ? "active" : ""}
          type="button"
          onClick={() => navigate(modeRoot(mode))}
        >
          行情
        </button>
        <button
          className={route.page === "account" ? "active" : ""}
          type="button"
          onClick={() => navigate(accountPath(mode))}
        >
          资产
        </button>
        <button
          className={route.page === "orders" ? "active" : ""}
          type="button"
          onClick={() => navigate(ordersPath(mode, "ORDERS"))}
        >
          订单
        </button>
      </nav>

      {route.page === "home" ? (
        <HomePage
          account={account}
          displayCurrency={displayCurrency}
          mode={mode}
          onConnectionChange={handleConnectionChange}
          onOpenStock={(instrumentId) =>
            navigate(stockPath(mode, instrumentId))
          }
          onRequireAuth={requireAuth}
        />
      ) : null}

      {route.page === "stock" ? (
        <StockPage
          account={account}
          displayCurrency={displayCurrency}
          instrumentId={route.instrumentId}
          mode={mode}
          onBack={() => navigate(modeRoot(mode))}
          onConnectionChange={handleConnectionChange}
          onRequireAuth={requireAuth}
        />
      ) : null}

      {route.page === "account" ? (
        <AccountPage
          account={account}
          displayCurrency={displayCurrency}
          mode={mode}
          onOpenStock={(instrumentId) =>
            navigate(stockPath(mode, instrumentId))
          }
          onRequireAuth={requireAuth}
        />
      ) : null}

      {route.page === "orders" ? (
        <OrdersPage
          account={account}
          displayCurrency={displayCurrency}
          mode={mode}
          onOpenStock={(instrumentId) =>
            navigate(stockPath(mode, instrumentId))
          }
          onRequireAuth={requireAuth}
          onTabChange={(tab) => navigate(ordersPath(mode, tab))}
          tab={route.tab}
        />
      ) : null}

      {route.page === "auth" ? (
        <AuthPage
          onAuthenticated={handleAuthenticated}
          onBack={() => navigate(modeRoot(mode))}
        />
      ) : null}

      {account && accountVerified && !account.email ? (
        <EmailCompletionCard
          account={account}
          onCompleted={handleEmailCompleted}
          onLogout={handleLogout}
        />
      ) : null}
    </div>
  );
}

function parseRoute(pathname: string): Route {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  const mode: MarketMode =
    normalized === "/real" || normalized.startsWith("/real/")
      ? "REAL"
      : "VIRTUAL";
  const localPath =
    mode === "REAL"
      ? normalized.slice("/real".length) || "/"
      : normalized;

  if (localPath === "/account") {
    return { page: "account", mode };
  }

  if (localPath === "/orders" || localPath === "/orders/transactions") {
    return {
      page: "orders",
      mode,
      tab: localPath.endsWith("/transactions")
        ? "TRANSACTIONS"
        : "ORDERS",
    };
  }

  if (localPath === "/auth" || localPath === "/login") {
    return { page: "auth", mode };
  }

  const stockMatch = localPath.match(/^\/stocks?\/([^/]+)$/);

  if (stockMatch?.[1]) {
    return {
      page: "stock",
      mode,
      instrumentId: decodeURIComponent(stockMatch[1]),
    };
  }

  return { page: "home", mode };
}

function modeRoot(mode: MarketMode): string {
  return mode === "REAL" ? "/real" : "/";
}

function accountPath(mode: MarketMode): string {
  return mode === "REAL" ? "/real/account" : "/account";
}

function ordersPath(mode: MarketMode, tab: OrdersTab): string {
  const prefix = mode === "REAL" ? "/real" : "";
  return `${prefix}/orders${tab === "TRANSACTIONS" ? "/transactions" : ""}`;
}

function stockPath(mode: MarketMode, instrumentId: string): string {
  const prefix = mode === "REAL" ? "/real" : "";
  return `${prefix}/stocks/${encodeURIComponent(instrumentId)}`;
}
