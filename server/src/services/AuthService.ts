import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type {
  AuthResult,
  DisplayCurrency,
  EmailVerificationRequestResult,
  PasswordResetConfirmResult,
  PasswordResetRequestResult,
  PublicAccount,
  RegistrationEmailVerificationConfirmResult,
} from "@gupiaomoniqi/shared";
import { GAME_RULES } from "../config.js";
import type {
  AccountRecord,
  EmailVerificationChallengeRecord,
  GameRepository,
  PasswordResetChallengeRecord,
  RegistrationEmailChallengeRecord,
} from "../repositories/GameRepository.js";
import type { PasswordResetMailer } from "./PasswordResetMailer.js";

const scryptAsync = promisify(scrypt);
const PASSWORD_RESET_TTL_MS = 10 * 60 * 1_000;
const PASSWORD_RESET_ATTEMPTS = 5;

export class AuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export class AuthService {
  constructor(
    private readonly repository: GameRepository,
    private readonly clock: () => Date = () => new Date(),
    private readonly passwordResetMailer: PasswordResetMailer | null = null,
  ) {}

  async register(input: {
    username: string;
    email: string;
    password: string;
    displayName: string;
    emailVerificationToken?: string;
  }): Promise<AuthResult> {
    const username = input.username.trim();
    const usernameNormalized = normalizeUsername(username);
    const email = input.email.trim();
    const emailNormalized = normalizeEmail(email);

    if (this.repository.getAccountByUsername(usernameNormalized)) {
      throw new AuthError("ACCOUNT_EXISTS", "这个用户名已经被注册", 409);
    }
    if (this.repository.getAccountByEmail(emailNormalized)) {
      throw new AuthError("EMAIL_EXISTS", "这个邮箱已经被注册", 409);
    }

    const now = this.clock();
    const registrationVerification = input.emailVerificationToken
      ? this.#requireRegistrationEmailVerification(
          emailNormalized,
          input.emailVerificationToken,
          now,
        )
      : undefined;
    const account: AccountRecord = {
      id: randomUUID(),
      username,
      usernameNormalized,
      email,
      emailNormalized,
      passwordHash: await hashPassword(input.password),
      displayName: input.displayName.trim(),
      displayCurrency: "USD",
      createdAt: now.toISOString(),
      lastLoginAt: now.toISOString(),
    };

    try {
      await this.repository.createAccount(
        {
          account,
          portfolio: {
            id: randomUUID(),
            accountId: account.id,
            mode: "VIRTUAL",
            initialCashUsd: GAME_RULES.initialCashUsd,
            availableCashUsd: GAME_RULES.initialCashUsd,
            frozenCashUsd: 0,
          },
        },
        registrationVerification
          ? {
              challengeId: registrationVerification.id,
              emailNormalized,
              consumedAt: now.toISOString(),
            }
          : undefined,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "ACCOUNT_EXISTS"
      ) {
        throw new AuthError(
          "ACCOUNT_EXISTS",
          "这个用户名已经被注册",
          409,
        );
      }
      if (error instanceof Error && error.message === "EMAIL_EXISTS") {
        throw new AuthError("EMAIL_EXISTS", "这个邮箱已经被注册", 409);
      }
      if (
        error instanceof Error &&
        error.message === "REGISTRATION_EMAIL_NOT_VERIFIED"
      ) {
        throw registrationEmailVerificationRequired();
      }
      throw error;
    }

    return this.#issueSession(account);
  }

  async login(input: {
    username: string;
    password: string;
  }): Promise<AuthResult> {
    const identifier = input.username.trim();
    const account =
      this.repository.getAccountByUsername(normalizeUsername(identifier)) ??
      (identifier.includes("@")
        ? this.repository.getAccountByEmail(normalizeEmail(identifier))
        : undefined);

    if (
      !account ||
      !(await verifyPassword(input.password, account.passwordHash))
    ) {
      throw new AuthError(
        "INVALID_CREDENTIALS",
        "用户名、邮箱或密码错误",
        401,
      );
    }

    const now = this.clock().toISOString();
    await this.repository.updateLastLogin(account.id, now);
    account.lastLoginAt = now;
    return this.#issueSession(account);
  }

  async requestPasswordReset(input: {
    email: string;
  }): Promise<PasswordResetRequestResult> {
    if (!this.passwordResetMailer) {
      throw new AuthError(
        "PASSWORD_RESET_UNAVAILABLE",
        "邮件发送尚未配置，请联系管理员重置密码",
        503,
      );
    }

    const account = this.repository.getAccountByEmail(
      normalizeEmail(input.email),
    );
    if (!account?.email) {
      return {
        accepted: true,
        expiresInSeconds: PASSWORD_RESET_TTL_MS / 1_000,
      };
    }

    const now = this.clock();
    const code = createSixDigitCode();
    const challenge: PasswordResetChallengeRecord = {
      id: randomUUID(),
      accountId: account.id,
      codeHash: await hashPassword(code),
      expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS).toISOString(),
      attemptsRemaining: PASSWORD_RESET_ATTEMPTS,
      consumedAt: null,
      createdAt: now.toISOString(),
    };
    await this.repository.replacePasswordResetChallenge(challenge);

    try {
      await this.passwordResetMailer.sendPasswordResetCode({
        to: account.email,
        code,
        expiresInMinutes: PASSWORD_RESET_TTL_MS / 60_000,
      });
    } catch {
      challenge.consumedAt = this.clock().toISOString();
      await this.repository.updatePasswordResetChallenge(challenge);
      throw new AuthError(
        "PASSWORD_RESET_DELIVERY_FAILED",
        "验证码邮件发送失败，请稍后再试",
        503,
      );
    }

    return {
      accepted: true,
      expiresInSeconds: PASSWORD_RESET_TTL_MS / 1_000,
    };
  }

  async confirmPasswordReset(input: {
    email: string;
    code: string;
    newPassword: string;
  }): Promise<PasswordResetConfirmResult> {
    const account = this.repository.getAccountByEmail(
      normalizeEmail(input.email),
    );
    const challenge = account
      ? this.repository.getPasswordResetChallenge(account.id)
      : undefined;
    const now = this.clock();

    if (
      !account ||
      !challenge ||
      challenge.consumedAt ||
      challenge.attemptsRemaining <= 0 ||
      new Date(challenge.expiresAt).getTime() <= now.getTime()
    ) {
      throw invalidResetCode();
    }

    if (!(await verifyPassword(input.code, challenge.codeHash))) {
      await this.repository.recordPasswordResetFailure(
        account.id,
        challenge.id,
        now.toISOString(),
      );
      throw invalidResetCode();
    }

    try {
      await this.repository.resetPassword(
        account.id,
        await hashPassword(input.newPassword),
        challenge.id,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "PASSWORD_RESET_CHALLENGE_CONSUMED"
      ) {
        throw invalidResetCode();
      }
      throw error;
    }
    return { reset: true };
  }

  async requestEmailVerification(
    accountId: string,
    input: { email: string },
  ): Promise<EmailVerificationRequestResult> {
    if (!this.passwordResetMailer) {
      throw new AuthError(
        "EMAIL_VERIFICATION_UNAVAILABLE",
        "邮件发送尚未配置，请联系管理员补充邮箱",
        503,
      );
    }
    const account = this.repository.getAccountById(accountId);
    if (!account) {
      throw new AuthError("ACCOUNT_NOT_FOUND", "账户不存在", 404);
    }
    if (account.emailNormalized) {
      throw new AuthError(
        "ACCOUNT_EMAIL_ALREADY_SET",
        "账户已经绑定邮箱",
        409,
      );
    }

    const email = input.email.trim();
    const emailNormalized = normalizeEmail(email);
    if (this.repository.getAccountByEmail(emailNormalized)) {
      throw new AuthError(
        "EMAIL_UNAVAILABLE",
        "这个邮箱暂时无法绑定",
        409,
      );
    }

    const now = this.clock();
    const code = createSixDigitCode();
    const challenge: EmailVerificationChallengeRecord = {
      id: randomUUID(),
      accountId,
      email,
      emailNormalized,
      codeHash: await hashPassword(code),
      expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS).toISOString(),
      attemptsRemaining: PASSWORD_RESET_ATTEMPTS,
      consumedAt: null,
      createdAt: now.toISOString(),
    };
    await this.repository.replaceEmailVerificationChallenge(challenge);

    try {
      await this.passwordResetMailer.sendEmailVerificationCode({
        to: email,
        code,
        expiresInMinutes: PASSWORD_RESET_TTL_MS / 60_000,
      });
    } catch {
      challenge.consumedAt = this.clock().toISOString();
      await this.repository.updateEmailVerificationChallenge(challenge);
      throw new AuthError(
        "EMAIL_VERIFICATION_DELIVERY_FAILED",
        "验证码邮件发送失败，请稍后再试",
        503,
      );
    }

    return {
      accepted: true,
      expiresInSeconds: PASSWORD_RESET_TTL_MS / 1_000,
    };
  }

  async requestRegistrationEmailVerification(input: {
    email: string;
  }): Promise<EmailVerificationRequestResult> {
    if (!this.passwordResetMailer) {
      throw new AuthError(
        "EMAIL_VERIFICATION_UNAVAILABLE",
        "邮件发送尚未配置，暂时无法注册新账户",
        503,
      );
    }

    const email = input.email.trim();
    const emailNormalized = normalizeEmail(email);
    if (this.repository.getAccountByEmail(emailNormalized)) {
      throw new AuthError("EMAIL_EXISTS", "这个邮箱已经被注册", 409);
    }

    const now = this.clock();
    const code = createSixDigitCode();
    const challenge: RegistrationEmailChallengeRecord = {
      id: randomUUID(),
      email,
      emailNormalized,
      codeHash: await hashPassword(code),
      expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS).toISOString(),
      attemptsRemaining: PASSWORD_RESET_ATTEMPTS,
      verifiedAt: null,
      consumedAt: null,
      createdAt: now.toISOString(),
    };
    await this.repository.replaceRegistrationEmailChallenge(challenge);

    try {
      await this.passwordResetMailer.sendRegistrationEmailVerificationCode({
        to: email,
        code,
        expiresInMinutes: PASSWORD_RESET_TTL_MS / 60_000,
      });
    } catch {
      challenge.consumedAt = this.clock().toISOString();
      await this.repository.updateRegistrationEmailChallenge(challenge);
      throw new AuthError(
        "EMAIL_VERIFICATION_DELIVERY_FAILED",
        "验证码邮件发送失败，请稍后再试",
        503,
      );
    }

    return {
      accepted: true,
      expiresInSeconds: PASSWORD_RESET_TTL_MS / 1_000,
    };
  }

  async confirmRegistrationEmailVerification(input: {
    email: string;
    code: string;
  }): Promise<RegistrationEmailVerificationConfirmResult> {
    const emailNormalized = normalizeEmail(input.email);
    const challenge =
      this.repository.getRegistrationEmailChallenge(emailNormalized);
    const now = this.clock();
    if (
      !challenge ||
      challenge.consumedAt ||
      challenge.attemptsRemaining <= 0 ||
      new Date(challenge.expiresAt).getTime() <= now.getTime()
    ) {
      throw invalidRegistrationEmailCode();
    }

    if (!(await verifyPassword(input.code, challenge.codeHash))) {
      await this.repository.recordRegistrationEmailFailure(
        emailNormalized,
        challenge.id,
        now.toISOString(),
      );
      throw invalidRegistrationEmailCode();
    }

    if (
      !(await this.repository.verifyRegistrationEmailChallenge(
        emailNormalized,
        challenge.id,
        now.toISOString(),
      ))
    ) {
      throw invalidRegistrationEmailCode();
    }

    return {
      verificationToken: challenge.id,
      expiresInSeconds: Math.max(
        1,
        Math.ceil(
          (new Date(challenge.expiresAt).getTime() - now.getTime()) / 1_000,
        ),
      ),
    };
  }

  async confirmEmailVerification(
    accountId: string,
    input: { email: string; code: string },
  ): Promise<PublicAccount> {
    const account = this.repository.getAccountById(accountId);
    if (!account) {
      throw new AuthError("ACCOUNT_NOT_FOUND", "账户不存在", 404);
    }
    if (account.emailNormalized) {
      throw new AuthError(
        "ACCOUNT_EMAIL_ALREADY_SET",
        "账户已经绑定邮箱",
        409,
      );
    }

    const emailNormalized = normalizeEmail(input.email);
    const challenge = this.repository.getEmailVerificationChallenge(accountId);
    const now = this.clock();
    if (
      !challenge ||
      challenge.emailNormalized !== emailNormalized ||
      challenge.consumedAt ||
      challenge.attemptsRemaining <= 0 ||
      new Date(challenge.expiresAt).getTime() <= now.getTime()
    ) {
      throw invalidEmailVerificationCode();
    }

    if (!(await verifyPassword(input.code, challenge.codeHash))) {
      await this.repository.recordEmailVerificationFailure(
        accountId,
        challenge.id,
        now.toISOString(),
      );
      throw invalidEmailVerificationCode();
    }

    try {
      await this.repository.bindAccountEmail(
        accountId,
        challenge.email,
        challenge.emailNormalized,
        challenge.id,
      );
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      if (error.message === "EMAIL_EXISTS") {
        throw new AuthError(
          "EMAIL_UNAVAILABLE",
          "这个邮箱暂时无法绑定",
          409,
        );
      }
      if (error.message === "EMAIL_VERIFICATION_CHALLENGE_CONSUMED") {
        throw invalidEmailVerificationCode();
      }
      if (error.message === "ACCOUNT_EMAIL_ALREADY_SET") {
        throw new AuthError(
          "ACCOUNT_EMAIL_ALREADY_SET",
          "账户已经绑定邮箱",
          409,
        );
      }
      throw error;
    }

    const updated = this.repository.getAccountById(accountId);
    if (!updated) {
      throw new AuthError("ACCOUNT_NOT_FOUND", "账户不存在", 404);
    }
    return toPublicAccount(updated);
  }

  authenticate(authorization: string | undefined): AccountRecord | undefined {
    const token = bearerToken(authorization);

    if (!token) {
      return undefined;
    }

    const session = this.repository.getSession(hashToken(token));
    return session
      ? this.repository.getAccountById(session.accountId)
      : undefined;
  }

  async logout(authorization: string | undefined): Promise<void> {
    const token = bearerToken(authorization);

    if (token) {
      await this.repository.deleteSession(hashToken(token));
    }
  }

  async setDisplayCurrency(
    accountId: string,
    currency: DisplayCurrency,
  ): Promise<PublicAccount> {
    await this.repository.updateDisplayCurrency(accountId, currency);
    const account = this.repository.getAccountById(accountId);

    if (!account) {
      throw new AuthError("ACCOUNT_NOT_FOUND", "账户不存在", 404);
    }

    return toPublicAccount(account);
  }

  async #issueSession(account: AccountRecord): Promise<AuthResult> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      this.clock().getTime() + GAME_RULES.sessionTtlMs,
    ).toISOString();

    await this.repository.createSession({
      tokenHash: hashToken(token),
      accountId: account.id,
      expiresAt,
    });

    return {
      token,
      account: toPublicAccount(account),
    };
  }

  #requireRegistrationEmailVerification(
    emailNormalized: string,
    verificationToken: string,
    now: Date,
  ): RegistrationEmailChallengeRecord {
    const challenge =
      this.repository.getRegistrationEmailChallenge(emailNormalized);
    if (
      !challenge ||
      challenge.id !== verificationToken ||
      !challenge.verifiedAt ||
      challenge.consumedAt ||
      new Date(challenge.expiresAt).getTime() <= now.getTime()
    ) {
      throw registrationEmailVerificationRequired();
    }
    return challenge;
  }
}

export function toPublicAccount(account: AccountRecord): PublicAccount {
  return {
    id: account.id,
    username: account.username,
    email: account.email,
    displayName: account.displayName,
    displayCurrency: account.displayCurrency,
    createdAt: account.createdAt,
  };
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function invalidRegistrationEmailCode(): AuthError {
  return new AuthError(
    "INVALID_EMAIL_VERIFICATION_CODE",
    "验证码无效、已过期或尝试次数已用完",
    400,
  );
}

function registrationEmailVerificationRequired(): AuthError {
  return new AuthError(
    "EMAIL_VERIFICATION_REQUIRED",
    "请先完成注册邮箱验证码校验",
    400,
  );
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function bearerToken(authorization: string | undefined): string | undefined {
  const match = authorization?.match(/^Bearer\s+([A-Za-z0-9_-]+)$/i);
  return match?.[1];
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derivedKey.toString("base64url")}`;
}

function invalidResetCode(): AuthError {
  return new AuthError(
    "INVALID_PASSWORD_RESET_CODE",
    "验证码无效、已过期或尝试次数已用完",
    400,
  );
}

function invalidEmailVerificationCode(): AuthError {
  return new AuthError(
    "INVALID_EMAIL_VERIFICATION_CODE",
    "验证码无效、已过期或尝试次数已用完",
    400,
  );
}

function createSixDigitCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const [algorithm, saltText, hashText] = encoded.split("$");

  if (algorithm !== "scrypt" || !saltText || !hashText) {
    return false;
  }

  const expected = Buffer.from(hashText, "base64url");
  const actual = (await scryptAsync(
    password,
    Buffer.from(saltText, "base64url"),
    expected.length,
  )) as Buffer;

  return (
    expected.length === actual.length &&
    timingSafeEqual(expected, actual)
  );
}
