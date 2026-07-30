import type { FastifyInstance, FastifyReply } from "fastify";
import {
  AppUpdateConfigurationError,
  AppUpdateService,
} from "./AppUpdateService.js";

interface UpdateQuery {
  currentVersionCode?: string;
}

export function registerAppUpdateRoutes(
  app: FastifyInstance,
  service: AppUpdateService,
): void {
  app.get<{
    Querystring: UpdateQuery;
  }>("/api/android/update", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const currentVersionCode = parseVersionCode(
      request.query.currentVersionCode,
    );
    if (currentVersionCode === null) {
      return reply.status(400).send({
        code: "INVALID_VERSION_CODE",
        message:
          "currentVersionCode must be a non-negative safe integer",
      });
    }

    try {
      return {
        data: await service.checkForUpdate(currentVersionCode),
      };
    } catch (error) {
      return sendConfigurationError(error, request.log, reply);
    }
  });

  app.get("/api/android/update/apk", async (request, reply) => {
    reply.header("Cache-Control", "private, no-cache");
    let download;
    try {
      download = await service.createDownload();
    } catch (error) {
      if (error instanceof AppUpdateConfigurationError) {
        request.log.error(
          { err: error },
          "Android update package is unavailable",
        );
        return sendNotFound(reply);
      }
      throw error;
    }

    if (!download) {
      return sendNotFound(reply);
    }

    if (request.headers["if-none-match"] === download.etag) {
      download.stream.destroy();
      return reply
        .status(304)
        .header("ETag", download.etag)
        .send();
    }

    return reply
      .header(
        "Content-Type",
        "application/vnd.android.package-archive",
      )
      .header("Content-Length", download.release.sizeBytes)
      .header("ETag", download.etag)
      .header(
        "Content-Disposition",
        `attachment; filename="${download.fileName}"`,
      )
      .send(download.stream);
  });
}

function parseVersionCode(rawValue: string | undefined): number | null {
  if (
    rawValue === undefined ||
    !/^(?:0|[1-9][0-9]*)$/.test(rawValue)
  ) {
    return null;
  }
  const value = Number(rawValue);
  return Number.isSafeInteger(value) ? value : null;
}

function sendConfigurationError(
  error: unknown,
  logger: {
    error(
      bindings: Record<string, unknown>,
      message: string,
    ): void;
  },
  reply: FastifyReply,
) {
  if (!(error instanceof AppUpdateConfigurationError)) {
    throw error;
  }
  logger.error(
    { err: error },
    "Android update manifest is unavailable",
  );
  return reply.status(503).send({
    code: "APP_UPDATE_UNAVAILABLE",
    message: "The Android update is temporarily unavailable",
  });
}

function sendNotFound(reply: FastifyReply) {
  return reply.status(404).send({
    code: "APP_UPDATE_NOT_FOUND",
    message: "No Android update package has been published",
  });
}
