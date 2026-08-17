import type { PublicAccount } from "@gupiaomoniqi/shared";
import { type FormEvent, useState } from "react";
import {
  confirmEmailVerification,
  requestEmailVerification,
} from "../api";

interface EmailCompletionCardProps {
  account: PublicAccount;
  onCompleted: (account: PublicAccount) => void;
  onLogout: () => void | Promise<void>;
}

export function EmailCompletionCard({
  account,
  onCompleted,
  onLogout,
}: EmailCompletionCardProps) {
  const [email, setEmail] = useState("");
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loading) {
      return;
    }
    setLoading(true);
    setError(null);

    try {
      if (!sentEmail) {
        const normalized = email.trim();
        await requestEmailVerification(normalized);
        setSentEmail(normalized);
        setNotice("六位验证码已经发出，有效期 10 分钟。请检查收件箱和垃圾邮件。");
      } else {
        const updated = await confirmEmailVerification({
          email: sentEmail,
          code,
        });
        onCompleted(updated);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "操作失败");
    } finally {
      setLoading(false);
    }
  }

  function changeEmail() {
    setSentEmail(null);
    setCode("");
    setNotice(null);
    setError(null);
  }

  return (
    <div className="email-completion-backdrop">
      <section
        aria-labelledby="email-completion-title"
        aria-modal="true"
        className="email-completion-card"
        role="dialog"
      >
        <span className="eyebrow">ACCOUNT RECOVERY · REQUIRED</span>
        <h2 id="email-completion-title">请先补充找回邮箱</h2>
        <p>
          账户 <strong>@{account.username}</strong> 还没有邮箱资料。绑定并验证邮箱后，
          才能继续使用资产与模拟交易功能，也可以在忘记密码时收取六位验证码。
        </p>

        <form className="email-completion-form" onSubmit={submit}>
          <label>
            <span>找回邮箱</span>
            <input
              autoComplete="email"
              disabled={sentEmail !== null}
              maxLength={254}
              placeholder="name@example.com"
              required
              type="email"
              value={sentEmail ?? email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          {sentEmail ? (
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
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
              />
            </label>
          ) : null}

          {notice ? <div className="inline-notice success">{notice}</div> : null}
          {error ? <div className="inline-notice error">{error}</div> : null}

          <button className="auth-submit" disabled={loading} type="submit">
            {loading
              ? "请稍候…"
              : sentEmail
                ? "验证并绑定邮箱"
                : "发送六位验证码"}
          </button>
        </form>

        <div className="email-completion-actions">
          {sentEmail ? (
            <button disabled={loading} type="button" onClick={changeEmail}>
              更换邮箱
            </button>
          ) : null}
          <button disabled={loading} type="button" onClick={() => void onLogout()}>
            退出此账户
          </button>
        </div>
        <small>本系统只向该邮箱发送验证码，不接收或读取你的邮件。</small>
      </section>
    </div>
  );
}
