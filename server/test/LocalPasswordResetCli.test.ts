import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateDatabase } from "../src/db/migrations.js";
import {
  hashPassword,
  verifyPassword,
} from "../src/services/AuthService.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    await rm(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe("服务器本机密码重置脚本", () => {
  it("不加载行情仓库即可改密、补邮箱并撤销会话", async () => {
    const databaseDirectory = await mkdtemp(
      join(tmpdir(), "gupiaomoniqi-reset-cli-"),
    );
    temporaryDirectories.push(databaseDirectory);
    const client = new PGlite(databaseDirectory);
    await client.waitReady;
    await migrateDatabase(client);
    await client.query(
      `INSERT INTO accounts (
         id, username, username_normalized, password_hash, display_name
       ) VALUES ($1, $2, $3, $4, $5)`,
      [
        "11111111-1111-4111-8111-111111111111",
        "cli_user",
        "cli_user",
        await hashPassword("OldPass123"),
        "本机改密测试员",
      ],
    );
    await client.query(
      `INSERT INTO sessions (token_hash, account_id, expires_at)
       VALUES ($1, $2, $3)`,
      [
        "old-session",
        "11111111-1111-4111-8111-111111111111",
        "2026-09-17T00:00:00.000Z",
      ],
    );
    await client.close();

    const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
    const output = execFileSync(
      process.execPath,
      [
        join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs"),
        join(projectRoot, "scripts", "reset-account-password.ts"),
        "--username",
        "cli_user",
        "--set-email",
        "cli_user@example.com",
        "--password-stdin",
      ],
      {
        cwd: projectRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_DIR: databaseDirectory,
        },
        input: "NewPass456\n",
      },
    );
    expect(JSON.parse(output)).toMatchObject({
      reset: true,
      username: "cli_user",
      email: "cli_user@example.com",
      revokedSessions: 1,
    });

    const reloaded = new PGlite(databaseDirectory);
    await reloaded.waitReady;
    const account = await reloaded.query<{
      email: string;
      email_normalized: string;
      password_hash: string;
    }>(
      `SELECT email, email_normalized, password_hash
         FROM accounts WHERE username_normalized = 'cli_user'`,
    );
    const session = await reloaded.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM sessions`,
    );
    await reloaded.close();

    expect(account.rows[0]).toMatchObject({
      email: "cli_user@example.com",
      email_normalized: "cli_user@example.com",
    });
    expect(
      await verifyPassword("NewPass456", account.rows[0]!.password_hash),
    ).toBe(true);
    expect(session.rows[0]?.count).toBe(0);
  }, 15_000);
});
