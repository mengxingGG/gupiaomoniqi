import { createApplication } from "./application.js";
import { SERVER_CONFIG } from "./config.js";
import {
  resolveShutdownConfirmationPath,
  resolveShutdownRequestPath,
  startShutdownRequestWatcher,
  writeShutdownConfirmation,
  type ShutdownRequest,
  type ShutdownRequestWatcher,
} from "./runtime/ShutdownRequestWatcher.js";

const context = await createApplication({
  logger: true,
});

let backgroundStartTimer: NodeJS.Timeout | null = null;
let shutdownWatcher: ShutdownRequestWatcher | null = null;
let shutdownPromise: Promise<void> | null = null;
let shutdownConfirmationPath: string | null = null;

try {
  await context.app.listen({
    host: SERVER_CONFIG.host,
    port: SERVER_CONFIG.port,
  });

  context.loadController.start();
  context.runtime.start();
  backgroundStartTimer = setTimeout(() => {
    backgroundStartTimer = null;
    context.aiRuntime.start();
    context.llmTradingRuntime?.start();
    context.realRuntime.start();
  }, 1_000);
  backgroundStartTimer.unref();

  const shutdownRequestPath = resolveShutdownRequestPath(
    process.env.APP_RUNTIME_DIR,
    process.env.APP_SHUTDOWN_REQUEST_PATH,
  );
  shutdownConfirmationPath = resolveShutdownConfirmationPath(
    process.env.APP_RUNTIME_DIR,
    process.env.APP_SHUTDOWN_CONFIRMATION_PATH,
  );
  const instanceNonce = process.env.APP_INSTANCE_NONCE;
  if (
    shutdownRequestPath &&
    shutdownConfirmationPath &&
    instanceNonce
  ) {
    shutdownWatcher = startShutdownRequestWatcher({
      requestPath: shutdownRequestPath,
      processId: process.pid,
      instanceNonce,
      onShutdown: async (request) => {
        await shutdown("deployment update", request);
      },
      onError: (error) => {
        context.app.log.error(
          error,
          "failed to inspect the deployment shutdown request",
        );
      },
    });
  }
} catch (error) {
  context.app.log.error(error);
  if (backgroundStartTimer) {
    clearTimeout(backgroundStartTimer);
    backgroundStartTimer = null;
  }
  shutdownWatcher?.stop();
  shutdownWatcher = null;
  try {
    await context.app.close();
  } catch (closeError) {
    context.app.log.error(
      closeError,
      "failed to close after a startup error",
    );
  }
  process.exit(1);
}

function shutdown(
  reason: string,
  request?: ShutdownRequest,
): Promise<void> {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
    shutdownWatcher?.stop();
    shutdownWatcher = null;
    if (backgroundStartTimer) {
      clearTimeout(backgroundStartTimer);
      backgroundStartTimer = null;
    }

    context.app.log.info({ reason }, "graceful shutdown started");
    try {
      await context.app.close();
      if (request) {
        if (!shutdownConfirmationPath) {
          throw new Error(
            "Shutdown confirmation path is unavailable",
          );
        }
        await writeShutdownConfirmation(
          shutdownConfirmationPath,
          {
            version: 1,
            status: "closed",
            processId: process.pid,
            instanceNonce: request.instanceNonce,
            requestReceivedAt: request.requestedAt,
            completedAt: new Date().toISOString(),
          },
        );
      }
      context.app.log.info({ reason }, "graceful shutdown completed");
      process.exit(0);
    } catch (error) {
      context.app.log.error(error, "graceful shutdown failed");
      process.exit(1);
    }
  })();

  return shutdownPromise;
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
