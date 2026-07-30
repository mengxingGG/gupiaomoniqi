import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createApplication,
  type ApplicationContext,
} from "../src/application.js";
import { createTestHarness } from "./helpers.js";

const PACKAGE_NAME = "com.mengxinggg.gupiaomoniqi";

let context: ApplicationContext | undefined;
let temporaryRoot: string;
let updateDirectory: string;

beforeEach(async () => {
  temporaryRoot = await mkdtemp(
    join(tmpdir(), "gupiaomoniqi-app-update-"),
  );
  updateDirectory = join(temporaryRoot, "updates");
});

afterEach(async () => {
  if (context) {
    await context.app.close();
    context = undefined;
  }
  await rm(temporaryRoot, { force: true, recursive: true });
});

describe("Android app update API", () => {
  it("returns no update before the first release is published", async () => {
    await createContext();

    const check = await context!.app.inject({
      method: "GET",
      url: "/api/android/update?currentVersionCode=1",
    });
    const download = await context!.app.inject({
      method: "GET",
      url: "/api/android/update/apk",
    });

    expect(check.statusCode).toBe(200);
    expect(check.headers["cache-control"]).toBe("no-store");
    expect(check.json()).toEqual({
      data: {
        platform: "ANDROID",
        currentVersionCode: 1,
        updateAvailable: false,
        release: null,
      },
    });
    expect(download.statusCode).toBe(404);
    expect(download.headers["cache-control"]).toBe(
      "private, no-cache",
    );
    expect(download.json().code).toBe("APP_UPDATE_NOT_FOUND");
  });

  it("advertises only newer releases and streams the verified APK", async () => {
    const published = await publishFixture({
      versionCode: 20,
      versionName: "0.2.0",
      apk: Buffer.from("signed-apk-fixture-v20"),
      mandatory: false,
      releaseNotes: "首个正式测试版本",
    });
    await createContext();

    const update = await context!.app.inject({
      method: "GET",
      url: "/api/android/update?currentVersionCode=19",
    });
    const current = await context!.app.inject({
      method: "GET",
      url: "/api/android/update?currentVersionCode=20",
    });
    const newerClient = await context!.app.inject({
      method: "GET",
      url: "/api/android/update?currentVersionCode=21",
    });

    expect(update.statusCode).toBe(200);
    expect(update.headers["cache-control"]).toBe("no-store");
    expect(update.json()).toEqual({
      data: {
        platform: "ANDROID",
        currentVersionCode: 19,
        updateAvailable: true,
        release: {
          packageName: PACKAGE_NAME,
          versionCode: 20,
          versionName: "0.2.0",
          apkPath: "/api/android/update/apk",
          sha256: published.sha256,
          sizeBytes: published.apk.length,
          publishedAt: "2026-07-30T06:00:00.000Z",
          mandatory: false,
          releaseNotes: "首个正式测试版本",
        },
      },
    });
    expect(current.json().data).toMatchObject({
      currentVersionCode: 20,
      updateAvailable: false,
      release: null,
    });
    expect(newerClient.json().data).toMatchObject({
      currentVersionCode: 21,
      updateAvailable: false,
      release: null,
    });

    const download = await context!.app.inject({
      method: "GET",
      url: "/api/android/update/apk",
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toContain(
      "application/vnd.android.package-archive",
    );
    expect(download.headers["content-length"]).toBe(
      String(published.apk.length),
    );
    expect(download.headers.etag).toBe(`"${published.sha256}"`);
    expect(download.headers["content-disposition"]).toBe(
      `attachment; filename="${published.fileName}"`,
    );
    expect(download.rawPayload).toEqual(published.apk);

    const notModified = await context!.app.inject({
      method: "GET",
      url: "/api/android/update/apk",
      headers: {
        "if-none-match": `"${published.sha256}"`,
      },
    });
    expect(notModified.statusCode).toBe(304);
    expect(notModified.headers.etag).toBe(
      `"${published.sha256}"`,
    );
    expect(notModified.rawPayload).toHaveLength(0);
  });

  it("rejects malformed currentVersionCode values", async () => {
    await createContext();

    for (const query of [
      "",
      "-1",
      "1.5",
      "1e2",
      "9007199254740992",
      "abc",
    ]) {
      const suffix = query ? `=${query}` : "";
      const response = await context!.app.inject({
        method: "GET",
        url: `/api/android/update?currentVersionCode${suffix}`,
      });

      expect(response.statusCode, query).toBe(400);
      expect(response.headers["cache-control"], query).toBe(
        "no-store",
      );
      expect(response.json().code, query).toBe(
        "INVALID_VERSION_CODE",
      );
    }
  });

  it("never follows manifest path traversal outside the update directory", async () => {
    const outsideApk = Buffer.from("outside-secret-apk");
    const outsidePath = join(temporaryRoot, "outside.apk");
    await writeFile(outsidePath, outsideApk);
    await writeManifest({
      apkFile: "../outside.apk",
      sha256: sha256(outsideApk),
      sizeBytes: outsideApk.length,
    });
    await createContext();

    const check = await context!.app.inject({
      method: "GET",
      url: "/api/android/update?currentVersionCode=1",
    });
    const download = await context!.app.inject({
      method: "GET",
      url: "/api/android/update/apk",
    });

    expect(check.statusCode).toBe(503);
    expect(check.json().code).toBe("APP_UPDATE_UNAVAILABLE");
    expect(check.body).not.toContain("outside-secret-apk");
    expect(download.statusCode).toBe(404);
    expect(download.rawPayload).not.toEqual(outsideApk);
  });

  it("refuses to advertise an APK with the wrong size or sha256", async () => {
    const apk = Buffer.from("tampered-apk");
    await mkdir(updateDirectory, { recursive: true });
    await writeFile(join(updateDirectory, "release-v20.apk"), apk);
    await writeManifest({
      apkFile: "release-v20.apk",
      sha256: "0".repeat(64),
      sizeBytes: apk.length,
    });
    await createContext();

    const hashMismatch = await context!.app.inject({
      method: "GET",
      url: "/api/android/update?currentVersionCode=1",
    });
    expect(hashMismatch.statusCode).toBe(503);

    await writeManifest({
      apkFile: "release-v20.apk",
      sha256: sha256(apk),
      sizeBytes: apk.length + 1,
    });
    const sizeMismatch = await context!.app.inject({
      method: "GET",
      url: "/api/android/update?currentVersionCode=1",
    });
    expect(sizeMismatch.statusCode).toBe(503);

    const download = await context!.app.inject({
      method: "GET",
      url: "/api/android/update/apk",
    });
    expect(download.statusCode).toBe(404);
  });

  it("observes atomically replaced manifests without restarting", async () => {
    await publishFixture({
      versionCode: 20,
      versionName: "0.2.0",
      apk: Buffer.from("release-twenty"),
    });
    await createContext();

    const first = await context!.app.inject({
      method: "GET",
      url: "/api/android/update?currentVersionCode=1",
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().data.release.versionCode).toBe(20);

    const next = await publishFixture({
      versionCode: 21,
      versionName: "0.2.1",
      apk: Buffer.from("release-twenty-one-with-a-new-size"),
    });
    const second = await context!.app.inject({
      method: "GET",
      url: "/api/android/update?currentVersionCode=20",
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.release).toMatchObject({
      versionCode: 21,
      versionName: "0.2.1",
      sha256: next.sha256,
      sizeBytes: next.apk.length,
    });

    const download = await context!.app.inject({
      method: "GET",
      url: "/api/android/update/apk",
    });
    expect(download.rawPayload).toEqual(next.apk);
  });
});

async function createContext(): Promise<void> {
  const { repository } = await createTestHarness({
    registerAccount: false,
  });
  context = await createApplication({
    repository,
    appUpdateDirectory: updateDirectory,
    aiEnabled: false,
    realSyncEnabled: false,
  });
}

interface FixtureOptions {
  versionCode: number;
  versionName: string;
  apk: Buffer;
  mandatory?: boolean;
  releaseNotes?: string;
}

async function publishFixture(options: FixtureOptions) {
  const fileName = `gupiaomoniqi-${options.versionName}-v${options.versionCode}.apk`;
  const checksum = sha256(options.apk);
  await mkdir(updateDirectory, { recursive: true });
  await writeFile(join(updateDirectory, fileName), options.apk);
  await writeManifest({
    versionCode: options.versionCode,
    versionName: options.versionName,
    apkFile: fileName,
    sha256: checksum,
    sizeBytes: options.apk.length,
    mandatory: options.mandatory ?? false,
    releaseNotes: options.releaseNotes ?? "",
  });
  return {
    fileName,
    sha256: checksum,
    apk: options.apk,
  };
}

async function writeManifest(
  overrides: Partial<{
    packageName: string;
    versionCode: number;
    versionName: string;
    apkFile: string;
    sha256: string;
    sizeBytes: number;
    publishedAt: string;
    mandatory: boolean;
    releaseNotes: string;
  }>,
): Promise<void> {
  await mkdir(updateDirectory, { recursive: true });
  const manifest = {
    packageName: PACKAGE_NAME,
    versionCode: 20,
    versionName: "0.2.0",
    apkFile: "gupiaomoniqi-0.2.0-v20.apk",
    sha256: "0".repeat(64),
    sizeBytes: 1,
    publishedAt: "2026-07-30T06:00:00.000Z",
    mandatory: false,
    releaseNotes: "",
    ...overrides,
  };
  const destination = join(updateDirectory, "latest.json");
  const temporary = join(
    dirname(destination),
    `.latest-${randomUUID()}.tmp`,
  );
  await writeFile(
    temporary,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await rename(temporary, destination);
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
