import { createHash } from "node:crypto";
import {
  createReadStream,
  type ReadStream,
  type Stats,
} from "node:fs";
import {
  lstat,
  open,
  readFile,
  type FileHandle,
} from "node:fs/promises";
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { z } from "zod";
import {
  ANDROID_PACKAGE_NAME,
  type AndroidApkDownload,
  type AndroidRelease,
  type AndroidUpdateCheck,
} from "./types.js";

const MANIFEST_FILE_NAME = "latest.json";
const MAXIMUM_MANIFEST_BYTES = 64 * 1024;
const SAFE_APK_BASENAME =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,198})\.apk$/i;

const manifestSchema = z
  .object({
    packageName: z.literal(ANDROID_PACKAGE_NAME),
    versionCode: z.number().int().positive().safe(),
    versionName: z.string().trim().min(1).max(100),
    apkFile: z.string().min(1).max(240),
    sha256: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .transform((value) => value.toLowerCase()),
    sizeBytes: z.number().int().positive().safe(),
    publishedAt: z.string().datetime({ offset: true }),
    mandatory: z.boolean(),
    releaseNotes: z.string().max(20_000),
  })
  .strict();

interface Manifest {
  packageName: typeof ANDROID_PACKAGE_NAME;
  versionCode: number;
  versionName: string;
  apkFile: string;
  sha256: string;
  sizeBytes: number;
  publishedAt: string;
  mandatory: boolean;
  releaseNotes: string;
}

interface ValidatedRelease {
  release: AndroidRelease;
  apkPath: string;
  fileName: string;
  manifestFingerprint: string;
  apkFingerprint: string;
}

export class AppUpdateConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AppUpdateConfigurationError";
  }
}

export class AppUpdateService {
  readonly #directory: string;
  readonly #manifestPath: string;
  #cachedRelease: ValidatedRelease | null | undefined;
  #loading: Promise<ValidatedRelease | null> | undefined;

  constructor(directory: string) {
    this.#directory = resolve(directory);
    this.#manifestPath = join(this.#directory, MANIFEST_FILE_NAME);
  }

  async checkForUpdate(
    currentVersionCode: number,
  ): Promise<AndroidUpdateCheck> {
    const validated = await this.#getLatestRelease();
    const updateAvailable =
      validated !== null &&
      validated.release.versionCode > currentVersionCode;

    return {
      platform: "ANDROID",
      currentVersionCode,
      updateAvailable,
      release: updateAvailable ? validated.release : null,
    };
  }

  async createDownload(): Promise<AndroidApkDownload | null> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const validated = await this.#getLatestRelease();
      if (!validated) {
        return null;
      }

      let handle: FileHandle | undefined;
      try {
        handle = await open(validated.apkPath, "r");
        const stats = await handle.stat();
        if (
          !stats.isFile() ||
          fingerprint(stats) !== validated.apkFingerprint
        ) {
          await handle.close();
          handle = undefined;
          this.#cachedRelease = undefined;
          continue;
        }

        const stream = handle.createReadStream({
          autoClose: true,
        });
        handle = undefined;
        return {
          release: validated.release,
          fileName: validated.fileName,
          etag: `"${validated.release.sha256}"`,
          stream,
        };
      } catch (error) {
        if (handle) {
          await handle.close().catch(() => undefined);
        }
        if (isMissingFileError(error)) {
          this.#cachedRelease = undefined;
          continue;
        }
        throw error;
      }
    }

    throw new AppUpdateConfigurationError(
      "Android update APK changed while it was being opened",
    );
  }

  async #getLatestRelease(): Promise<ValidatedRelease | null> {
    if (this.#loading) {
      return this.#loading;
    }

    const loading = this.#loadLatestRelease();
    this.#loading = loading;
    try {
      return await loading;
    } finally {
      if (this.#loading === loading) {
        this.#loading = undefined;
      }
    }
  }

  async #loadLatestRelease(): Promise<ValidatedRelease | null> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const manifestStats = await safeLstat(this.#manifestPath);
      if (!manifestStats) {
        this.#cachedRelease = null;
        return null;
      }
      assertRegularFile(manifestStats, "Android update manifest");
      if (manifestStats.size > MAXIMUM_MANIFEST_BYTES) {
        throw new AppUpdateConfigurationError(
          `Android update manifest exceeds ${MAXIMUM_MANIFEST_BYTES} bytes`,
        );
      }

      const manifestFingerprint = fingerprint(manifestStats);
      const cached = this.#cachedRelease;
      if (
        cached &&
        cached.manifestFingerprint === manifestFingerprint
      ) {
        const apkStats = await safeLstat(cached.apkPath);
        if (
          apkStats &&
          apkStats.isFile() &&
          !apkStats.isSymbolicLink() &&
          fingerprint(apkStats) === cached.apkFingerprint
        ) {
          return cached;
        }
      }

      const manifest = await this.#readManifest();
      const manifestStatsAfterRead = await safeLstat(
        this.#manifestPath,
      );
      if (
        !manifestStatsAfterRead ||
        fingerprint(manifestStatsAfterRead) !== manifestFingerprint
      ) {
        continue;
      }

      const apkPath = this.#resolveApkPath(manifest.apkFile);
      const apkStats = await safeLstat(apkPath);
      if (!apkStats) {
        throw new AppUpdateConfigurationError(
          `Android update APK does not exist: ${manifest.apkFile}`,
        );
      }
      assertRegularFile(apkStats, "Android update APK");
      if (apkStats.size !== manifest.sizeBytes) {
        throw new AppUpdateConfigurationError(
          `Android update APK size mismatch for ${manifest.apkFile}`,
        );
      }

      const apkFingerprint = fingerprint(apkStats);
      const sha256 = await hashFile(apkPath);
      const [apkStatsAfterHash, manifestStatsAfterHash] =
        await Promise.all([
          safeLstat(apkPath),
          safeLstat(this.#manifestPath),
        ]);
      if (
        !apkStatsAfterHash ||
        !manifestStatsAfterHash ||
        fingerprint(apkStatsAfterHash) !== apkFingerprint ||
        fingerprint(manifestStatsAfterHash) !==
          manifestFingerprint
      ) {
        continue;
      }
      if (sha256 !== manifest.sha256) {
        throw new AppUpdateConfigurationError(
          `Android update APK sha256 mismatch for ${manifest.apkFile}`,
        );
      }

      const validated: ValidatedRelease = {
        release: {
          packageName: manifest.packageName,
          versionCode: manifest.versionCode,
          versionName: manifest.versionName,
          apkPath: "/api/android/update/apk",
          sha256: manifest.sha256,
          sizeBytes: manifest.sizeBytes,
          publishedAt: manifest.publishedAt,
          mandatory: manifest.mandatory,
          releaseNotes: manifest.releaseNotes,
        },
        apkPath,
        fileName: manifest.apkFile,
        manifestFingerprint,
        apkFingerprint,
      };
      this.#cachedRelease = validated;
      return validated;
    }

    throw new AppUpdateConfigurationError(
      "Android update files changed while they were being validated",
    );
  }

  async #readManifest(): Promise<Manifest> {
    let rawManifest: string;
    try {
      rawManifest = await readFile(this.#manifestPath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        throw new AppUpdateConfigurationError(
          "Android update manifest disappeared while being read",
          { cause: error },
        );
      }
      throw error;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawManifest);
    } catch (error) {
      throw new AppUpdateConfigurationError(
        "Android update manifest is not valid JSON",
        { cause: error },
      );
    }

    const parsed = manifestSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new AppUpdateConfigurationError(
        `Android update manifest is invalid: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  #resolveApkPath(fileName: string): string {
    if (
      fileName !== basename(fileName) ||
      isAbsolute(fileName) ||
      fileName.includes("/") ||
      fileName.includes("\\") ||
      !SAFE_APK_BASENAME.test(fileName)
    ) {
      throw new AppUpdateConfigurationError(
        "Android update apkFile must be a safe APK basename",
      );
    }

    const apkPath = resolve(this.#directory, fileName);
    const relativePath = relative(this.#directory, apkPath);
    if (
      !relativePath ||
      relativePath.startsWith("..") ||
      isAbsolute(relativePath)
    ) {
      throw new AppUpdateConfigurationError(
        "Android update APK path escapes the update directory",
      );
    }
    return apkPath;
  }
}

function assertRegularFile(stats: Stats, description: string): void {
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new AppUpdateConfigurationError(
      `${description} must be a regular file`,
    );
  }
}

function fingerprint(stats: Stats): string {
  return [
    stats.dev,
    stats.ino,
    stats.size,
    stats.mtimeMs,
    stats.ctimeMs,
  ].join(":");
}

async function safeLstat(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream: ReadStream = createReadStream(path);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}
