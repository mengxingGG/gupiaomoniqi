export type PreparedDatabaseStatus = "ready" | "rebuilt";

export interface PreparedDatabaseResult {
  status: PreparedDatabaseStatus;
  backupPath: string | null;
}

export interface PrepareLocalDatabasesResult {
  virtual: PreparedDatabaseResult;
  real: PreparedDatabaseResult;
}

export interface PrepareLocalDatabasesOptions {
  virtualDatabaseDir: string;
  realDatabaseDir: string;
  marketSeedPath: string;
  inspectVirtualDatabase: () => Promise<void>;
  inspectRealDatabase: () => Promise<void>;
  rebuildVirtualDatabase: () => Promise<void>;
  rebuildRealDatabase: () => Promise<void>;
  ensureMarketSeed?: () => Promise<void>;
  backupDirectory: (directoryPath: string) => Promise<string>;
  pathExists: (filePath: string) => Promise<boolean>;
  now?: () => Date;
  delayMs?: (milliseconds: number) => Promise<void>;
}

export async function prepareLocalDatabases(
  options: PrepareLocalDatabasesOptions,
): Promise<PrepareLocalDatabasesResult> {
  const virtual = await ensureVirtualDatabase(options);
  const real = await ensureRealDatabase(options);

  return {
    virtual,
    real,
  };
}

async function ensureVirtualDatabase(
  options: PrepareLocalDatabasesOptions,
): Promise<PreparedDatabaseResult> {
  const virtualExists = await options.pathExists(options.virtualDatabaseDir);

  if (!virtualExists) {
    await ensureMarketSeed(
      options,
      "虚拟盘数据库缺失，且找不到 market-seeds.json",
    );

    await options.rebuildVirtualDatabase();
    await options.inspectVirtualDatabase();

    return {
      status: "rebuilt",
      backupPath: null,
    };
  }

  try {
    await options.inspectVirtualDatabase();

    return {
      status: "ready",
      backupPath: null,
    };
  } catch (error) {
    await ensureMarketSeed(
      options,
      `虚拟盘数据库损坏，且找不到 market-seeds.json：${errorMessage(error)}`,
    );

    const backupPath = await backupDirectoryWithRetry(
      options,
      options.virtualDatabaseDir,
    );
    await options.rebuildVirtualDatabase();
    await options.inspectVirtualDatabase();

    return {
      status: "rebuilt",
      backupPath,
    };
  }
}

async function ensureMarketSeed(
  options: PrepareLocalDatabasesOptions,
  missingMessage: string,
): Promise<void> {
  if (await options.pathExists(options.marketSeedPath)) {
    return;
  }

  if (!options.ensureMarketSeed) {
    throw new Error(missingMessage);
  }

  try {
    await options.ensureMarketSeed();
  } catch (error) {
    throw new Error(`${missingMessage}；自动获取失败：${errorMessage(error)}`);
  }

  if (!(await options.pathExists(options.marketSeedPath))) {
    throw new Error(
      `${missingMessage}；自动获取结束后仍未生成 market-seeds.json`,
    );
  }
}

async function ensureRealDatabase(
  options: PrepareLocalDatabasesOptions,
): Promise<PreparedDatabaseResult> {
  try {
    await options.inspectRealDatabase();

    return {
      status: "ready",
      backupPath: null,
    };
  } catch {
    const realExists = await options.pathExists(options.realDatabaseDir);
    const backupPath = realExists
      ? await backupDirectoryWithRetry(
          options,
          options.realDatabaseDir,
        )
      : null;

    await options.rebuildRealDatabase();
    await options.inspectRealDatabase();

    return {
      status: "rebuilt",
      backupPath,
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function backupDirectoryWithRetry(
  options: PrepareLocalDatabasesOptions,
  directoryPath: string,
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await options.backupDirectory(directoryPath);
    } catch (error) {
      lastError = error;
      if (!isRetryableDirectoryLock(error) || attempt === 5) {
        throw wrapLockError(error, directoryPath);
      }
      await (options.delayMs ?? defaultDelayMs)(500 * (attempt + 1));
    }
  }

  throw wrapLockError(lastError, directoryPath);
}

function isRetryableDirectoryLock(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "EPERM" || error.code === "EBUSY")
  );
}

function wrapLockError(error: unknown, directoryPath: string): Error {
  if (!isRetryableDirectoryLock(error)) {
    return error instanceof Error ? error : new Error(String(error));
  }
  return new Error(
    `数据库目录仍被占用，无法备份 ${directoryPath}。请确认旧的本地服务进程已经退出后再重试。原始错误：${errorMessage(error)}`,
  );
}

function defaultDelayMs(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
