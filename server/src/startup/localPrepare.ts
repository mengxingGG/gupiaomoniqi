import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { importMarketSeeds } from "../db/importMarketSeeds.js";
import { getDatabaseDirectory } from "../db/client.js";
import { getRealDatabaseDirectory, openRealDatabase } from "../real-market/db/client.js";
import { migrateRealDatabase } from "../real-market/db/migrations.js";
import {
  fetchMarketSeedSnapshot,
  VIRTUAL_MARKET_SEED_COUNT_PER_MARKET,
} from "./marketSeedBootstrap.js";
import { prepareLocalDatabases } from "./prepareLocalDatabases.js";

const execFileAsync = promisify(execFile);
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const tsxCliPath = fileURLToPath(
  new URL("../../../node_modules/tsx/dist/cli.mjs", import.meta.url),
);
const virtualDatabaseDir = getDatabaseDirectory();
const realDatabaseDir = getRealDatabaseDirectory();
const marketSeedPath =
  process.env.MARKET_SEED_PATH ??
  fileURLToPath(new URL("../../data/market-seeds.json", import.meta.url));

try {
  const result = await prepareLocalDatabases({
    virtualDatabaseDir,
    realDatabaseDir,
    marketSeedPath,
    inspectVirtualDatabase,
    inspectRealDatabase,
    rebuildVirtualDatabase,
    rebuildRealDatabase,
    ensureMarketSeed: () => fetchMarketSeedSnapshot(marketSeedPath),
    backupDirectory,
    pathExists,
  });

  printSummary(result);
} catch (error) {
  console.error(`[PREP] 启动准备失败：${errorMessage(error)}`);
  process.exitCode = 1;
}

async function inspectVirtualDatabase(): Promise<void> {
  await runInspectScript("server/src/db/inspect.ts");
}

async function inspectRealDatabase(): Promise<void> {
  await runInspectScript("server/src/real-market/db/inspect.ts");
}

async function rebuildVirtualDatabase(): Promise<void> {
  await importMarketSeeds(marketSeedPath, {
    deleteSnapshotAfterImport: true,
    expectedPerMarket: VIRTUAL_MARKET_SEED_COUNT_PER_MARKET,
  });
}

async function rebuildRealDatabase(): Promise<void> {
  await rm(realDatabaseDir, {
    recursive: true,
    force: true,
  });
  await mkdir(dirname(realDatabaseDir), {
    recursive: true,
  });

  const { client } = await openRealDatabase(realDatabaseDir);

  try {
    await migrateRealDatabase(client);
  } finally {
    await client.close();
  }
}

async function backupDirectory(directoryPath: string): Promise<string> {
  const normalizedDirectoryPath = trimTrailingSeparators(directoryPath);
  const backupPath = `${normalizedDirectoryPath}.broken-${formatTimestamp(new Date())}`;
  await mkdir(dirname(normalizedDirectoryPath), {
    recursive: true,
  });
  await rename(normalizedDirectoryPath, backupPath);
  return backupPath;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runInspectScript(scriptPath: string): Promise<void> {
  try {
    await execFileAsync(process.execPath, [tsxCliPath, scriptPath], {
      cwd: workspaceRoot,
      env: process.env,
    });
  } catch (error) {
    throw new Error(extractExecErrorMessage(error));
  }
}

function printSummary(
  result: Awaited<ReturnType<typeof prepareLocalDatabases>>,
): void {
  console.log(
    `[PREP] 虚拟盘数据库：${result.virtual.status}${formatBackup(result.virtual.backupPath)}`,
  );
  console.log(
    `[PREP] 真实盘数据库：${result.real.status}${formatBackup(result.real.backupPath)}`,
  );
}

function formatBackup(backupPath: string | null): string {
  return backupPath ? `，备份到 ${backupPath}` : "";
}

function formatTimestamp(value: Date): string {
  const year = String(value.getFullYear());
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");
  const seconds = String(value.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function trimTrailingSeparators(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractExecErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "stderr" in error &&
    typeof error.stderr === "string" &&
    error.stderr.trim().length > 0
  ) {
    return error.stderr.trim();
  }
  if (
    error &&
    typeof error === "object" &&
    "stdout" in error &&
    typeof error.stdout === "string" &&
    error.stdout.trim().length > 0
  ) {
    return error.stdout.trim();
  }
  return errorMessage(error);
}
