import { describe, expect, it, vi } from "vitest";
import { createApplication } from "../src/application.js";
import { AuthError, AuthService } from "../src/services/AuthService.js";
import type {
  EmailVerificationMail,
  PasswordResetMail,
  PasswordResetMailer,
} from "../src/services/PasswordResetMailer.js";
import { createTestHarness } from "./helpers.js";

class CapturingMailer implements PasswordResetMailer {
  readonly messages: PasswordResetMail[] = [];
  readonly emailVerificationMessages: EmailVerificationMail[] = [];

  async sendPasswordResetCode(mail: PasswordResetMail): Promise<void> {
    this.messages.push(mail);
  }

  async sendEmailVerificationCode(
    mail: EmailVerificationMail,
  ): Promise<void> {
    this.emailVerificationMessages.push(mail);
  }
}

describe("邮箱密码找回", () => {
  it("HTTP 接口完成注册、发码、重置和邮箱登录", async () => {
    const { repository } = await createTestHarness({
      registerAccount: false,
    });
    const mailer = new CapturingMailer();
    const context = await createApplication({
      repository,
      passwordResetMailer: mailer,
    });
    try {
      const registration = await context.app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          username: "http_recover",
          email: "http_recover@example.com",
          displayName: "HTTP 找回测试员",
          password: "OldPass123",
        },
      });
      expect(registration.statusCode).toBe(201);

      const requested = await context.app.inject({
        method: "POST",
        url: "/api/auth/password-reset/request",
        payload: { email: "http_recover@example.com" },
      });
      expect(requested.statusCode).toBe(202);
      expect(requested.json().data).toMatchObject({
        accepted: true,
        expiresInSeconds: 600,
      });

      const confirmed = await context.app.inject({
        method: "POST",
        url: "/api/auth/password-reset/confirm",
        payload: {
          email: "http_recover@example.com",
          code: mailer.messages[0]!.code,
          newPassword: "NewPass456",
        },
      });
      expect(confirmed.statusCode).toBe(200);
      expect(confirmed.json().data).toEqual({ reset: true });

      const loginResponse = await context.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          username: "http_recover@example.com",
          password: "NewPass456",
        },
      });
      expect(loginResponse.statusCode).toBe(200);
      expect(loginResponse.json().data.account.username).toBe("http_recover");
    } finally {
      await context.app.close();
    }
  });

  it("发送六位码、限制错误尝试并在重置后注销旧会话", async () => {
    let now = new Date("2026-08-17T12:00:00.000Z");
    const { repository } = await createTestHarness({
      registerAccount: false,
      clock: () => now,
    });
    const mailer = new CapturingMailer();
    const service = new AuthService(repository, () => now, mailer);
    const registered = await service.register({
      username: "recover_user",
      email: "Recover.User@example.com",
      displayName: "找回测试员",
      password: "OldPass123",
    });

    await expect(
      service.requestPasswordReset({ email: "missing@example.com" }),
    ).resolves.toMatchObject({ accepted: true });
    expect(mailer.messages).toHaveLength(0);

    await service.requestPasswordReset({
      email: "recover.user@EXAMPLE.com",
    });
    expect(mailer.messages).toHaveLength(1);
    const code = mailer.messages[0]!.code;
    expect(code).toMatch(/^\d{6}$/);

    await expect(
      service.confirmPasswordReset({
        email: "recover.user@example.com",
        code: code === "000000" ? "000001" : "000000",
        newPassword: "NewPass456",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_PASSWORD_RESET_CODE",
    });

    await expect(
      service.confirmPasswordReset({
        email: "recover.user@example.com",
        code,
        newPassword: "NewPass456",
      }),
    ).resolves.toEqual({ reset: true });
    await expect(
      service.confirmPasswordReset({
        email: "recover.user@example.com",
        code,
        newPassword: "AnotherPass789",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_PASSWORD_RESET_CODE",
    });
    expect(
      service.authenticate(`Bearer ${registered.token}`),
    ).toBeUndefined();
    await expect(
      service.login({ username: "recover_user", password: "OldPass123" }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      service.login({
        username: "recover.user@example.com",
        password: "NewPass456",
      }),
    ).resolves.toMatchObject({
      account: {
        username: "recover_user",
        email: "Recover.User@example.com",
      },
    });
  });

  it("验证码过期后不能使用，邮箱不能重复注册", async () => {
    let now = new Date("2026-08-17T12:00:00.000Z");
    const { repository } = await createTestHarness({
      registerAccount: false,
      clock: () => now,
    });
    const mailer = new CapturingMailer();
    const service = new AuthService(repository, () => now, mailer);
    await service.register({
      username: "first_user",
      email: "same@example.com",
      displayName: "第一位用户",
      password: "FirstPass123",
    });
    await expect(
      service.register({
        username: "second_user",
        email: "SAME@example.com",
        displayName: "第二位用户",
        password: "SecondPass123",
      }),
    ).rejects.toMatchObject({ code: "EMAIL_EXISTS" });

    await service.requestPasswordReset({ email: "same@example.com" });
    now = new Date(now.getTime() + 10 * 60_000 + 1);
    await expect(
      service.confirmPasswordReset({
        email: "same@example.com",
        code: mailer.messages[0]!.code,
        newPassword: "ChangedPass123",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_PASSWORD_RESET_CODE",
    });
  });

  it("邮件未配置时明确返回不可用，而不是生成无法送达的验证码", async () => {
    const { repository } = await createTestHarness({
      registerAccount: false,
    });
    const service = new AuthService(repository);
    const replaceSpy = vi.spyOn(
      repository,
      "replacePasswordResetChallenge",
    );

    await expect(
      service.requestPasswordReset({ email: "any@example.com" }),
    ).rejects.toMatchObject({
      code: "PASSWORD_RESET_UNAVAILABLE",
      statusCode: 503,
    });
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});
