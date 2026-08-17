import type { AuthResult } from "@gupiaomoniqi/shared";
import { type FormEvent, useState } from "react";
import {
  confirmPasswordReset,
  login,
  register,
  requestPasswordReset,
} from "../api";

interface AuthPageProps {
  onAuthenticated: (result: AuthResult) => void;
  onBack: () => void;
}

type AuthMode = "register" | "login" | "forgot";

export function AuthPage({
  onAuthenticated,
  onBack,
}: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>("register");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetCodeSent, setResetCodeSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError(null);
    setNotice(null);
    if (nextMode !== "forgot") {
      setResetCodeSent(false);
      setResetCode("");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      if (mode === "forgot") {
        if (!resetCodeSent) {
          await requestPasswordReset(email.trim());
          setResetCodeSent(true);
          setNotice("如果该邮箱已绑定账户，六位验证码已经发出，有效期 10 分钟。");
        } else {
          await confirmPasswordReset({
            email: email.trim(),
            code: resetCode,
            newPassword: password,
          });
          setUsername(email.trim());
          setPassword("");
          setResetCode("");
          setResetCodeSent(false);
          setMode("login");
          setNotice("密码已重置，旧登录会话已失效。现在可以用邮箱或用户名登录。");
        }
        return;
      }

      const result =
        mode === "register"
          ? await register({
              username,
              email,
              displayName,
              password,
            })
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

  const isRegister = mode === "register";
  const isForgot = mode === "forgot";

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
            <li>昵称用于展示，用户名用于识别，邮箱用于找回密码</li>
            <li>四个市场的持仓、现金和成交统一入账</li>
          </ul>
        </div>
      </section>

      <section className="auth-card-wrap">
        <div className="auth-card">
          {!isForgot ? (
            <div className="auth-mode-switch">
              <button
                className={isRegister ? "active" : ""}
                type="button"
                onClick={() => switchMode("register")}
              >
                注册账户
              </button>
              <button
                className={mode === "login" ? "active" : ""}
                type="button"
                onClick={() => switchMode("login")}
              >
                登录
              </button>
            </div>
          ) : null}

          <div className="auth-heading">
            <span className="eyebrow">
              {isForgot
                ? "RESET PASSWORD"
                : isRegister
                  ? "CREATE ACCOUNT"
                  : "WELCOME BACK"}
            </span>
            <h2>
              {isForgot
                ? "通过邮箱找回密码"
                : isRegister
                  ? "创建模拟交易账户"
                  : "登录模拟账户"}
            </h2>
            <p>
              {isForgot
                ? "我们会向绑定邮箱发送六位数字码，不会向你索取邮件内容。"
                : isRegister
                  ? "账户只用于模拟交易，不连接真实券商。"
                  : "继续查看你的统一资产、持仓和成交记录。"}
            </p>
          </div>

          <form className="auth-form" onSubmit={submit}>
            {isRegister ? (
              <label>
                <span>昵称 / 显示名称</span>
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

            {isRegister || isForgot ? (
              <label>
                <span>邮箱</span>
                <input
                  autoComplete="email"
                  disabled={isForgot && resetCodeSent}
                  maxLength={254}
                  placeholder="name@example.com"
                  required
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
            ) : null}

            {!isForgot ? (
              <label>
                <span>{isRegister ? "用户名" : "用户名或邮箱"}</span>
                <input
                  autoComplete="username"
                  maxLength={isRegister ? 20 : 254}
                  minLength={isRegister ? 3 : 1}
                  pattern={isRegister ? "[A-Za-z0-9_]+" : undefined}
                  placeholder={isRegister ? "字母、数字或下划线" : "输入用户名或邮箱"}
                  required
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>
            ) : null}

            {isForgot && resetCodeSent ? (
              <label>
                <span>六位验证码</span>
                <input
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={6}
                  minLength={6}
                  pattern="[0-9]{6}"
                  placeholder="000000"
                  required
                  value={resetCode}
                  onChange={(event) =>
                    setResetCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                />
              </label>
            ) : null}

            {!isForgot || resetCodeSent ? (
              <label>
                <span>{isForgot ? "新密码" : "密码"}</span>
                <input
                  autoComplete={
                    isRegister || isForgot ? "new-password" : "current-password"
                  }
                  maxLength={128}
                  minLength={isRegister || isForgot ? 8 : 1}
                  placeholder={
                    isRegister || isForgot
                      ? "至少 8 位，含大小写字母与数字"
                      : "输入密码"
                  }
                  required
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
            ) : null}

            {mode === "login" ? (
              <button
                className="auth-text-action"
                type="button"
                onClick={() => {
                  setEmail(username.includes("@") ? username : "");
                  setPassword("");
                  switchMode("forgot");
                }}
              >
                忘记密码？使用邮箱找回
              </button>
            ) : null}

            {isForgot ? (
              <button
                className="auth-text-action"
                type="button"
                onClick={() => switchMode("login")}
              >
                ← 返回登录
              </button>
            ) : null}

            {notice ? (
              <div className="inline-notice success" aria-live="polite">
                {notice}
              </div>
            ) : null}
            {error ? (
              <div className="inline-notice error" aria-live="polite">
                {error}
              </div>
            ) : null}

            <button className="auth-submit" disabled={loading} type="submit">
              {loading
                ? "请稍候…"
                : isForgot
                  ? resetCodeSent
                    ? "验证并设置新密码"
                    : "发送六位验证码"
                  : isRegister
                    ? "注册并领取模拟资金"
                    : "登录账户"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
