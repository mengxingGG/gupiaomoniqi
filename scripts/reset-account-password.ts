import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Writable } from "node:stream";
import { getDatabaseDirectory, openDatabase } from "../server/src/db/client.js";
import { migrateDatabase } from "../server/src/db/migrations.js";
import { hashPassword } from "../server/src/services/AuthService.js";

const options = parseArguments(process.argv.slice(2));
if (!options.username && !options.email) {
  throw new Error("请使用 --username <用户名> 或 --email <邮箱> 指定账户");
}

const password = options.passwordStdin
  ? (await readStandardInput()).trimEnd()
  : await promptForPassword();
assertStrongPassword(password);
const nextEmail = options.setEmail?.trim();
if (nextEmail && !isEmail(nextEmail)) {
  throw new Error("--set-email 不是有效邮箱地址");
}

const { client } = await openDatabase();
try {
  await migrateDatabase(client);
  const account = await client.query<{
    id: string;
    username: string;
    email: string | null;
  }>(
    options.username
      ? `SELECT id, username, email
           FROM accounts
          WHERE username_normalized = $1`
      : `SELECT id, username, email
           FROM accounts
          WHERE email_normalized = $1`,
    [normalizeIdentifier(options.username ?? options.email!)],
  );
  const record = account.rows[0];
  if (!record) {
    throw new Error("没有找到指定账户；数据库未作修改");
  }
  if (nextEmail) {
    const duplicate = await client.query<{ id: string }>(
      `SELECT id FROM accounts
        WHERE email_normalized = $1 AND id <> $2`,
      [normalizeIdentifier(nextEmail), record.id],
    );
    if (duplicate.rows.length > 0) {
      throw new Error("该邮箱已经绑定其他账户；数据库未作修改");
    }
  }

  const passwordHash = await hashPassword(password);
  let revokedSessions = 0;
  await client.transaction(async (transaction) => {
    await transaction.query(
      `UPDATE accounts
          SET password_hash = $2,
              email = COALESCE($3, email),
              email_normalized = COALESCE($4, email_normalized)
        WHERE id = $1`,
      [
        record.id,
        passwordHash,
        nextEmail ?? null,
        nextEmail ? normalizeIdentifier(nextEmail) : null,
      ],
    );
    const deleted = await transaction.query<{ count: number }>(
      `WITH revoked AS (
         DELETE FROM sessions WHERE account_id = $1 RETURNING 1
       )
       SELECT count(*)::int AS count FROM revoked`,
      [record.id],
    );
    revokedSessions = deleted.rows[0]?.count ?? 0;
    await transaction.query(
      `UPDATE password_reset_challenges
          SET consumed_at = now()
        WHERE account_id = $1 AND consumed_at IS NULL`,
      [record.id],
    );
    await transaction.query(
      `UPDATE email_verification_challenges
          SET consumed_at = now()
        WHERE account_id = $1 AND consumed_at IS NULL`,
      [record.id],
    );
  });

  console.log(
    JSON.stringify(
      {
        reset: true,
        username: record.username,
        email: nextEmail ?? record.email,
        revokedSessions,
        databaseDirectory: getDatabaseDirectory(),
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}

interface ResetOptions {
  username?: string;
  email?: string;
  passwordStdin: boolean;
  setEmail?: string;
}

function parseArguments(args: string[]): ResetOptions {
  const result: ResetOptions = { passwordStdin: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--username") {
      result.username = requireValue(args[++index], "--username");
    } else if (argument === "--email") {
      result.email = requireValue(args[++index], "--email");
    } else if (argument === "--password-stdin") {
      result.passwordStdin = true;
    } else if (argument === "--set-email") {
      result.setEmail = requireValue(args[++index], "--set-email");
    } else {
      throw new Error(`未知参数：${argument}`);
    }
  }
  if (result.username && result.email) {
    throw new Error("--username 与 --email 只能选择一个");
  }
  return result;
}

async function promptForPassword(): Promise<string> {
  if (!stdin.isTTY) {
    throw new Error("非交互环境请使用 --password-stdin 提供新密码");
  }
  const hiddenOutput = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const readline = createInterface({
    input: stdin,
    output: hiddenOutput,
    terminal: true,
  });
  try {
    stdout.write("请输入新密码：");
    const first = await readline.question("");
    stdout.write("\n请再次输入新密码：");
    const second = await readline.question("");
    stdout.write("\n");
    if (first !== second) {
      throw new Error("两次输入的密码不一致");
    }
    return first;
  } finally {
    readline.close();
  }
}

async function readStandardInput(): Promise<string> {
  let value = "";
  for await (const chunk of stdin) {
    value += String(chunk);
  }
  return value.replace(/\r?\n$/, "");
}

function assertStrongPassword(password: string): void {
  if (
    password.length < 8 ||
    password.length > 128 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password)
  ) {
    throw new Error("密码需为 8-128 位，并同时包含大小写字母与数字");
  }
}

function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function requireValue(
  value: string | undefined,
  argument: string,
): string {
  if (!value || value.startsWith("--")) {
    throw new Error(`${argument} 缺少参数值`);
  }
  return value;
}
