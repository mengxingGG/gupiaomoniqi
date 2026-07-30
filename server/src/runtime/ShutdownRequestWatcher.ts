import { randomUUID } from "node:crypto";
import {
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

const SHUTDOWN_REQUEST_FILE_NAME = "app-shutdown-request.json";
const SHUTDOWN_CONFIRMATION_FILE_NAME =
  "app-shutdown-confirmation.json";
const INSTANCE_NONCE_PATTERN = /^[a-f0-9]{32}$/i;

export interface ShutdownRequest {
  version: 1;
  processId: number;
  instanceNonce: string;
  requestedAt: string;
  reason?: string;
}

export interface ShutdownRequestIdentity {
  processId: number;
  instanceNonce: string;
}

export interface ShutdownConfirmation
  extends ShutdownRequestIdentity {
  version: 1;
  status: "closed";
  requestReceivedAt: string;
  completedAt: string;
}

export interface ShutdownRequestWatcher {
  stop(): void;
}

interface StartShutdownRequestWatcherOptions
  extends ShutdownRequestIdentity {
  requestPath: string;
  pollIntervalMs?: number;
  onShutdown(request: ShutdownRequest): Promise<void>;
  onError?(error: unknown): void;
}

export function resolveShutdownRequestPath(
  runtimeDirectory: string | undefined,
  configuredRequestPath: string | undefined,
): string | null {
  return resolveRuntimeControlPath(
    runtimeDirectory,
    configuredRequestPath,
    SHUTDOWN_REQUEST_FILE_NAME,
  );
}

export function resolveShutdownConfirmationPath(
  runtimeDirectory: string | undefined,
  configuredConfirmationPath: string | undefined,
): string | null {
  return resolveRuntimeControlPath(
    runtimeDirectory,
    configuredConfirmationPath,
    SHUTDOWN_CONFIRMATION_FILE_NAME,
  );
}

function resolveRuntimeControlPath(
  runtimeDirectory: string | undefined,
  configuredPath: string | undefined,
  fileName: string,
): string | null {
  if (
    !runtimeDirectory ||
    !configuredPath ||
    !isAbsolute(runtimeDirectory) ||
    !isAbsolute(configuredPath)
  ) {
    return null;
  }

  const expectedPath = resolve(runtimeDirectory, fileName);
  const candidatePath = resolve(configuredPath);
  const pathsMatch =
    process.platform === "win32"
      ? expectedPath.toLowerCase() === candidatePath.toLowerCase()
      : expectedPath === candidatePath;

  return pathsMatch ? candidatePath : null;
}

export function parseShutdownRequest(
  content: string,
  identity: ShutdownRequestIdentity,
): ShutdownRequest | null {
  if (
    !Number.isSafeInteger(identity.processId) ||
    identity.processId <= 0 ||
    !INSTANCE_NONCE_PATTERN.test(identity.instanceNonce)
  ) {
    return null;
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(content.replace(/^\uFEFF/u, ""));
  } catch {
    return null;
  }

  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const request = candidate as Partial<ShutdownRequest>;
  if (
    request.version !== 1 ||
    request.processId !== identity.processId ||
    request.instanceNonce !== identity.instanceNonce ||
    typeof request.requestedAt !== "string" ||
    !Number.isFinite(Date.parse(request.requestedAt)) ||
    (request.reason !== undefined &&
      typeof request.reason !== "string")
  ) {
    return null;
  }

  return request as ShutdownRequest;
}

export async function writeShutdownConfirmation(
  path: string,
  confirmation: ShutdownConfirmation,
): Promise<void> {
  if (
    !isAbsolute(path) ||
    confirmation.version !== 1 ||
    confirmation.status !== "closed" ||
    !Number.isSafeInteger(confirmation.processId) ||
    confirmation.processId <= 0 ||
    !INSTANCE_NONCE_PATTERN.test(confirmation.instanceNonce) ||
    !Number.isFinite(Date.parse(confirmation.requestReceivedAt)) ||
    !Number.isFinite(Date.parse(confirmation.completedAt))
  ) {
    throw new Error("Invalid shutdown confirmation");
  }

  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(confirmation)}\n`,
      {
        encoding: "utf8",
        flag: "wx",
      },
    );
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export function startShutdownRequestWatcher(
  options: StartShutdownRequestWatcherOptions,
): ShutdownRequestWatcher {
  let stopped = false;
  let checking = false;

  const stop = (): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    clearInterval(timer);
  };

  const inspectRequest = async (): Promise<void> => {
    if (stopped || checking) {
      return;
    }

    checking = true;
    try {
      const content = await readFile(options.requestPath, "utf8");
      const request = parseShutdownRequest(content, options);
      if (!request) {
        return;
      }

      stop();
      try {
        await unlink(options.requestPath);
      } catch (error) {
        if (!isMissingFileError(error)) {
          options.onError?.(error);
        }
      }
      await options.onShutdown(request);
    } catch (error) {
      if (!isMissingFileError(error)) {
        options.onError?.(error);
      }
    } finally {
      checking = false;
    }
  };

  const timer = setInterval(
    () => void inspectRequest(),
    options.pollIntervalMs ?? 250,
  );
  timer.unref();
  void inspectRequest();

  return { stop };
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
