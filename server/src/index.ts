import { createApplication } from "./application.js";
import { SERVER_CONFIG } from "./config.js";

const context = await createApplication({
  logger: true,
});

context.loadController.start();
context.runtime.start();
context.aiRuntime.start();
context.realRuntime.start();

try {
  await context.app.listen({
    host: SERVER_CONFIG.host,
    port: SERVER_CONFIG.port,
  });
} catch (error) {
  context.app.log.error(error);
  process.exitCode = 1;
}

async function shutdown(): Promise<void> {
  await context.app.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
