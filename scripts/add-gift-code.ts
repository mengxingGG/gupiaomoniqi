import { openDatabase } from "../server/src/db/client.js";
import { migrateDatabase } from "../server/src/db/migrations.js";

const argumentsMap = parseArguments(process.argv.slice(2));
const code = argumentsMap.get("code")?.trim();
const amountUsd = Number(argumentsMap.get("amount-usd"));
const repeatable = argumentsMap.has("repeatable");
const active = !argumentsMap.has("inactive");
const description = argumentsMap.get("description")?.trim() ?? "";

if (!code || code.length > 100) {
  fail(
    "请提供 1-100 位礼包码：--code <礼包码>",
  );
}
if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
  fail(
    "请提供大于 0 的美元金额：--amount-usd <金额>",
  );
}

const connection = await openDatabase();

try {
  await migrateDatabase(connection.client);
  await connection.client.query(
    `INSERT INTO gift_codes (
       code, amount_usd, repeatable, active, description, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (code) DO UPDATE SET
       amount_usd = excluded.amount_usd,
       repeatable = excluded.repeatable,
       active = excluded.active,
       description = excluded.description,
       updated_at = now()`,
    [code, amountUsd, repeatable, active, description],
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        code,
        amountUsd,
        repeatable,
        active,
        description,
      },
      null,
      2,
    ),
  );
} finally {
  await connection.client.close();
}

function parseArguments(values: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value?.startsWith("--")) {
      continue;
    }
    const key = value.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith("--")) {
      result.set(key, next);
      index += 1;
    } else {
      result.set(key, "true");
    }
  }
  return result;
}

function fail(message: string): never {
  console.error(message);
  console.error(
    "示例：npm run gift-code:add -- --code NEW2026 --amount-usd 250000 --description 活动礼包",
  );
  process.exit(1);
}
