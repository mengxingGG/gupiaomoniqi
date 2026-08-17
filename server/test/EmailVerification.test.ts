import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { createApplication } from "../src/application.js";
import { migrateDatabase } from "../src/db/migrations.js";
import * as schema from "../src/db/schema.js";
import { DatabaseGameRepository } from "../src/repositories/DatabaseGameRepository.js";
import type { GameRepository } from "../src/repositories/GameRepository.js";
import {
  AuthService,
  hashPassword,
} from "../src/services/AuthService.js";
import type {
  EmailVerificationMail,
  PasswordResetMail,
  PasswordResetMailer,
} from "../src/services/PasswordResetMailer.js";
import { createTestHarness } from "./helpers.js";

class CapturingAccountMailer implements PasswordResetMailer {
  readonly verificationMessages: EmailVerificationMail[] = [];

  async sendPasswordResetCode(_mail: PasswordResetMail): Promise<void> {}

  async sendEmailVerificationCode(
    mail: EmailVerificationMail,
  ): Promise<void> {
    this.verificationMessages.push(mail);
  }
}

describe("旧账户补充邮箱", () => {
  it("服务重启后仍可验证未过期验证码并持久化邮箱", async () => {
    const client = new PGlite();
    await client.waitReady;
    const connection = {
      client,
      db: drizzle({ client, schema }),
    };
    try {
      await migrateDatabase(client);
      const issuedAt = new Date();
      const repository = await DatabaseGameRepository.create(connection);
      const accountId = await createLegacyAccount(
        repository,
        "legacy_restart",
        "LegacyPass123",
      );
      const mailer = new CapturingAccountMailer();
      const service = new AuthService(
        repository,
        () => issuedAt,
        mailer,
      );
      await service.requestEmailVerification(accountId, {
        email: "restart@example.com",
      });

      const reloaded = await DatabaseGameRepository.create(connection);
      const reloadedService = new AuthService(
        reloaded,
        () => new Date(issuedAt.getTime() + 5 * 60_000),
        mailer,
      );
      await expect(
        reloadedService.confirmEmailVerification(accountId, {
          email: "restart@example.com",
          code: mailer.verificationMessages[0]!.code,
        }),
      ).resolves.toMatchObject({ email: "restart@example.com" });
      const persisted = await client.query<{
        email: string | null;
        email_normalized: string | null;
      }>(
        `SELECT email, email_normalized FROM accounts WHERE id = $1`,
        [accountId],
      );
      expect(persisted.rows[0]).toEqual({
        email: "restart@example.com",
        email_normalized: "restart@example.com",
      });
    } finally {
      await client.close();
    }
  });

  it("登录态发送六位码并由服务端验证后原子绑定邮箱", async () => {
    let now = new Date("2026-08-17T12:00:00.000Z");
    const { repository } = await createTestHarness({
      registerAccount: false,
      clock: () => now,
    });
    const accountId = await createLegacyAccount(
      repository,
      "legacy_user",
      "LegacyPass123",
    );
    const mailer = new CapturingAccountMailer();
    const service = new AuthService(repository, () => now, mailer);

    await expect(
      service.requestEmailVerification(accountId, {
        email: "Legacy.User@example.com",
      }),
    ).resolves.toEqual({ accepted: true, expiresInSeconds: 600 });
    expect(mailer.verificationMessages).toHaveLength(1);
    const code = mailer.verificationMessages[0]!.code;
    expect(code).toMatch(/^\d{6}$/);

    await expect(
      service.confirmEmailVerification(accountId, {
        email: "legacy.user@example.com",
        code: code === "000000" ? "000001" : "000000",
      }),
    ).rejects.toMatchObject({ code: "INVALID_EMAIL_VERIFICATION_CODE" });

    await expect(
      service.confirmEmailVerification(accountId, {
        email: "legacy.user@EXAMPLE.com",
        code,
      }),
    ).resolves.toMatchObject({
      username: "legacy_user",
      email: "Legacy.User@example.com",
    });
    await expect(
      service.login({
        username: "legacy.user@example.com",
        password: "LegacyPass123",
      }),
    ).resolves.toMatchObject({ account: { id: accountId } });
    await expect(
      service.confirmEmailVerification(accountId, {
        email: "legacy.user@example.com",
        code,
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_EMAIL_ALREADY_SET" });
  });

  it("过期验证码不可绑定，已占用邮箱返回不泄露归属的错误", async () => {
    let now = new Date("2026-08-17T12:00:00.000Z");
    const { repository } = await createTestHarness({
      registerAccount: false,
      clock: () => now,
    });
    const legacyId = await createLegacyAccount(
      repository,
      "legacy_expired",
      "LegacyPass123",
    );
    const mailer = new CapturingAccountMailer();
    const service = new AuthService(repository, () => now, mailer);
    await service.register({
      username: "email_owner",
      email: "used@example.com",
      displayName: "邮箱所有者",
      password: "OwnerPass123",
    });

    await expect(
      service.requestEmailVerification(legacyId, {
        email: "used@example.com",
      }),
    ).rejects.toMatchObject({ code: "EMAIL_UNAVAILABLE" });

    await service.requestEmailVerification(legacyId, {
      email: "fresh@example.com",
    });
    const code = mailer.verificationMessages[0]!.code;
    now = new Date(now.getTime() + 10 * 60_000 + 1);
    await expect(
      service.confirmEmailVerification(legacyId, {
        email: "fresh@example.com",
        code,
      }),
    ).rejects.toMatchObject({ code: "INVALID_EMAIL_VERIFICATION_CODE" });
  });

  it("并发错误尝试也会原子耗尽五次额度", async () => {
    const { repository } = await createTestHarness({ registerAccount: false });
    const accountId = await createLegacyAccount(
      repository,
      "legacy_attempts",
      "LegacyPass123",
    );
    const mailer = new CapturingAccountMailer();
    const service = new AuthService(repository, () => new Date(), mailer);
    await service.requestEmailVerification(accountId, {
      email: "attempts@example.com",
    });
    const correctCode = mailer.verificationMessages[0]!.code;
    const wrongCode = correctCode === "000000" ? "000001" : "000000";

    const failures = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        service.confirmEmailVerification(accountId, {
          email: "attempts@example.com",
          code: wrongCode,
        }),
      ),
    );
    expect(failures.every((result) => result.status === "rejected")).toBe(true);
    await expect(
      service.confirmEmailVerification(accountId, {
        email: "attempts@example.com",
        code: correctCode,
      }),
    ).rejects.toMatchObject({ code: "INVALID_EMAIL_VERIFICATION_CODE" });
  });

  it("HTTP 登录和自动恢复接口都暴露 email=null，绑定后立即返回新资料", async () => {
    const { repository } = await createTestHarness({ registerAccount: false });
    await createLegacyAccount(repository, "legacy_http", "LegacyPass123");
    const mailer = new CapturingAccountMailer();
    const context = await createApplication({
      repository,
      passwordResetMailer: mailer,
    });

    try {
      const health = await context.app.inject({
        method: "GET",
        url: "/api/health",
      });
      expect(health.json().data.emailDelivery).toEqual({
        configured: true,
        mode: "SMTP_SEND_ONLY",
      });
      const login = await context.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "legacy_http", password: "LegacyPass123" },
      });
      expect(login.statusCode).toBe(200);
      expect(login.json().data.account.email).toBeNull();
      const authorization = {
        authorization: `Bearer ${login.json().data.token as string}`,
      };
      const meBefore = await context.app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: authorization,
      });
      expect(meBefore.json().data.email).toBeNull();

      const requested = await context.app.inject({
        method: "POST",
        url: "/api/account/email-verification/request",
        headers: authorization,
        payload: { email: "legacy_http@example.com" },
      });
      expect(requested.statusCode).toBe(202);
      const confirmed = await context.app.inject({
        method: "POST",
        url: "/api/account/email-verification/confirm",
        headers: authorization,
        payload: {
          email: "legacy_http@example.com",
          code: mailer.verificationMessages[0]!.code,
        },
      });
      expect(confirmed.statusCode).toBe(200);
      expect(confirmed.json().data.email).toBe("legacy_http@example.com");
      const meAfter = await context.app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: authorization,
      });
      expect(meAfter.json().data.email).toBe("legacy_http@example.com");
    } finally {
      await context.app.close();
    }
  });
});

async function createLegacyAccount(
  repository: GameRepository,
  username: string,
  password: string,
): Promise<string> {
  const accountId = randomUUID();
  const now = "2026-08-17T12:00:00.000Z";
  await repository.createAccount({
    account: {
      id: accountId,
      username,
      usernameNormalized: username.toLowerCase(),
      email: null,
      emailNormalized: null,
      passwordHash: await hashPassword(password),
      displayName: `旧账户 ${username}`,
      displayCurrency: "USD",
      createdAt: now,
      lastLoginAt: null,
    },
    portfolio: {
      id: randomUUID(),
      accountId,
      mode: "VIRTUAL",
      initialCashUsd: 1_000_000,
      availableCashUsd: 1_000_000,
      frozenCashUsd: 0,
    },
  });
  return accountId;
}
