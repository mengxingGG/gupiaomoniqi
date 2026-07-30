import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseShutdownRequest,
  resolveShutdownConfirmationPath,
  resolveShutdownRequestPath,
  writeShutdownConfirmation,
} from "../src/runtime/ShutdownRequestWatcher.js";

const identity = {
  processId: 1234,
  instanceNonce: "0123456789abcdef0123456789abcdef",
};

describe("shutdown request validation", () => {
  it("accepts only the current process and nonce", () => {
    const request = {
      version: 1,
      ...identity,
      requestedAt: "2026-07-30T08:00:00.000Z",
      reason: "code-update",
    };

    expect(
      parseShutdownRequest(JSON.stringify(request), identity),
    ).toEqual(request);
    expect(
      parseShutdownRequest(
        `\uFEFF${JSON.stringify(request)}`,
        identity,
      ),
    ).toEqual(request);
    expect(
      parseShutdownRequest(
        JSON.stringify({ ...request, processId: 9999 }),
        identity,
      ),
    ).toBeNull();
    expect(
      parseShutdownRequest(
        JSON.stringify({
          ...request,
          instanceNonce: "fedcba9876543210fedcba9876543210",
        }),
        identity,
      ),
    ).toBeNull();
  });

  it("rejects malformed and stale requests", () => {
    expect(parseShutdownRequest("{", identity)).toBeNull();
    expect(
      parseShutdownRequest(
        JSON.stringify({
          version: 1,
          ...identity,
          requestedAt: "not-a-date",
        }),
        identity,
      ),
    ).toBeNull();
    expect(
      parseShutdownRequest(
        JSON.stringify({
          version: 2,
          ...identity,
          requestedAt: "2026-07-30T08:00:00.000Z",
        }),
        identity,
      ),
    ).toBeNull();
  });

  it("pins the control file to the configured runtime directory", () => {
    const runtimeDirectory = "C:\\ProgramData\\gupiaomoniqi\\runtime";
    const expectedPath = `${runtimeDirectory}\\app-shutdown-request.json`;

    expect(
      resolveShutdownRequestPath(runtimeDirectory, expectedPath),
    ).toBe(expectedPath);
    expect(
      resolveShutdownRequestPath(
        runtimeDirectory,
        "C:\\ProgramData\\gupiaomoniqi\\data\\request.json",
      ),
    ).toBeNull();
    expect(
      resolveShutdownRequestPath(
        runtimeDirectory,
        `${runtimeDirectory}\\nested\\..\\other.json`,
      ),
    ).toBeNull();
    expect(
      resolveShutdownConfirmationPath(
        runtimeDirectory,
        `${runtimeDirectory}\\app-shutdown-confirmation.json`,
      ),
    ).toBe(
      `${runtimeDirectory}\\app-shutdown-confirmation.json`,
    );
    expect(
      resolveShutdownConfirmationPath(
        runtimeDirectory,
        `${runtimeDirectory}\\confirmation.json`,
      ),
    ).toBeNull();
  });

  it("atomically writes a PID and nonce bound confirmation", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "gupiaomoniqi-shutdown-"),
    );
    const path = join(
      directory,
      "app-shutdown-confirmation.json",
    );
    const confirmation = {
      version: 1 as const,
      status: "closed" as const,
      ...identity,
      requestReceivedAt: "2026-07-30T08:00:00.000Z",
      completedAt: "2026-07-30T08:00:01.000Z",
    };

    try {
      await writeShutdownConfirmation(path, confirmation);
      const content = await readFile(path, "utf8");

      expect(content.charCodeAt(0)).not.toBe(0xfeff);
      expect(JSON.parse(content)).toEqual(confirmation);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
