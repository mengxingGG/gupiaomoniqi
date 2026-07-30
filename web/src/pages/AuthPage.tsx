import type { AuthResult } from "@gupiaomoniqi/shared";
import { type FormEvent, useState } from "react";
import { login, register } from "../api";

interface AuthPageProps {
  onAuthenticated: (result: AuthResult) => void;
  onBack: () => void;
}

export function AuthPage({
  onAuthenticated,
  onBack,
}: AuthPageProps) {
  const [mode, setMode] = useState<"register" | "login">("register");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const result =
        mode === "register"
          ? await register({ username, displayName, password })
          : await login({ username, password });
      onAuthenticated(result);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "操作失败",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-story">
        <button className="back-link" type="button" onClick={onBack}>
          ← 返回行情
        </button>
        <div className="auth-story-copy">
          <span className="eyebrow">ONE LEDGER · FOUR MARKETS</span>
          <h1>从一笔干净的模拟资金开始。</h1>
          <p>
            注册后自动获得 <strong>US$1,000,000</strong>，切换人民币时统一显示为
            <strong> ¥7,000,000</strong>。这是一份美元底层账本，不会重复创建两套资产。
          </p>
          <ul>
            <li>浏览行情无需注册，交易前才需要账户</li>
            <li>四个市场的持仓、现金和成交统一入账</li>
            <li>固定显示汇率 1 USD = 7 CNY，可随时切换</li>
          </ul>
        </div>
      </section>

      <section className="auth-card-wrap">
        <div className="auth-card">
          <div className="auth-mode-switch">
            <button
              className={mode === "register" ? "active" : ""}
              type="button"
              onClick={() => {
                setMode("register");
                setError(null);
              }}
            >
              注册账户
            </button>
            <button
              className={mode === "login" ? "active" : ""}
              type="button"
              onClick={() => {
                setMode("login");
                setError(null);
              }}
            >
              登录
            </button>
          </div>

          <div className="auth-heading">
            <span className="eyebrow">
              {mode === "register" ? "CREATE ACCOUNT" : "WELCOME BACK"}
            </span>
            <h2>{mode === "register" ? "创建模拟交易账户" : "登录模拟账户"}</h2>
            <p>
              {mode === "register"
                ? "账户只用于本地模拟交易，不连接真实券商。"
                : "继续查看你的统一资产、持仓和成交记录。"}
            </p>
          </div>

          <form className="auth-form" onSubmit={submit}>
            {mode === "register" ? (
              <label>
                <span>显示名称</span>
                <input
                  autoComplete="name"
                  maxLength={50}
                  placeholder="例如：星河交易员"
                  required
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
            ) : null}

            <label>
              <span>用户名</span>
              <input
                autoComplete="username"
                maxLength={20}
                minLength={mode === "register" ? 3 : 1}
                pattern={mode === "register" ? "[A-Za-z0-9_]+" : undefined}
                placeholder="字母、数字或下划线"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>

            <label>
              <span>密码</span>
              <input
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
                maxLength={128}
                minLength={mode === "register" ? 8 : 1}
                placeholder={
                  mode === "register"
                    ? "至少 8 位，含大小写字母与数字"
                    : "输入密码"
                }
                required
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>

            {error ? <div className="inline-notice error">{error}</div> : null}

            <button className="auth-submit" disabled={loading} type="submit">
              {loading
                ? "请稍候…"
                : mode === "register"
                  ? "注册并领取模拟资金"
                  : "登录账户"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
