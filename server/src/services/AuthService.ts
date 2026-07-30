import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type {
  AuthResult,
  DisplayCurrency,
  PublicAccount,
} from "@gupiaomoniqi/shared";
import { GAME_RULES } from "../config.js";
import type {
  AccountRecord,
  GameRepository,
} from "../repositories/GameRepository.js";

const scryptAsync = promisify(scrypt);

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
  ) {}

  async register(input: {
    username: string;
    password: string;
    displayName: string;
  }): Promise<AuthResult> {
    const username = input.username.trim();
    const usernameNormalized = normalizeUsername(username);

    if (this.repository.getAccountByUsername(usernameNormalized)) {
      throw new AuthError("ACCOUNT_EXISTS", "这个用户名已经被注册", 409);
    }

    const now = this.clock();
    const account: AccountRecord = {
      id: randomUUID(),
      username,
      usernameNormalized,
      passwordHash: await hashPassword(input.password),
      displayName: input.displayName.trim(),
      displayCurrency: "USD",
      createdAt: now.toISOString(),
      lastLoginAt: now.toISOString(),
    };

    try {
      await this.repository.createAccount({
        account,
        portfolio: {
          id: randomUUID(),
          accountId: account.id,
          mode: "VIRTUAL",
          initialCashUsd: GAME_RULES.initialCashUsd,
          availableCashUsd: GAME_RULES.initialCashUsd,
          frozenCashUsd: 0,
        },
      });
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
      throw error;
    }

    return this.#issueSession(account);
  }

  async login(input: {
    username: string;
    password: string;
  }): Promise<AuthResult> {
    const account = this.repository.getAccountByUsername(
      normalizeUsername(input.username),
    );

    if (
      !account ||
      !(await verifyPassword(input.password, account.passwordHash))
    ) {
      throw new AuthError(
        "INVALID_CREDENTIALS",
        "用户名或密码错误",
        401,
      );
    }

    const now = this.clock().toISOString();
    await this.repository.updateLastLogin(account.id, now);
    account.lastLoginAt = now;
    return this.#issueSession(account);
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
}

export function toPublicAccount(account: AccountRecord): PublicAccount {
  return {
    id: account.id,
    username: account.username,
    displayName: account.displayName,
    displayCurrency: account.displayCurrency,
    createdAt: account.createdAt,
  };
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function bearerToken(authorization: string | undefined): string | undefined {
  const match = authorization?.match(/^Bearer\s+([A-Za-z0-9_-]+)$/i);
  return match?.[1];
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derivedKey.toString("base64url")}`;
}

async function verifyPassword(
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
