import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import {
  basename,
  dirname,
  extname,
  join,
  resolve,
} from "node:path";

const PACKAGE_NAME = "com.mengxinggg.gupiaomoniqi";
const DEFAULT_OUTPUT_DIRECTORY =
  process.env.APP_UPDATE_DIR ?? "server/data/app-updates";

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const apkPath = resolve(required(options.apk, "--apk"));
  const outputDirectory = resolve(
    options.out ?? DEFAULT_OUTPUT_DIRECTORY,
  );
  const versionName = required(
    options.versionName,
    "--version-name",
  ).trim();
  const versionCode = parseVersionCode(
    required(options.versionCode, "--version-code"),
  );
  if (!versionName || versionName.length > 100) {
    throw new Error(
      "--version-name must contain between 1 and 100 characters",
    );
  }
  if (extname(apkPath).toLowerCase() !== ".apk") {
    throw new Error("--apk must point to an .apk file");
  }
  if (options.notes !== undefined && options.notesFile !== undefined) {
    throw new Error("Use either --notes or --notes-file, not both");
  }

  const sourceStatsBefore = await stat(apkPath);
  if (!sourceStatsBefore.isFile() || sourceStatsBefore.size <= 0) {
    throw new Error("--apk must point to a non-empty regular file");
  }
  const sha256 = await hashFile(apkPath);
  const sourceStatsAfter = await stat(apkPath);
  if (
    sourceStatsBefore.size !== sourceStatsAfter.size ||
    sourceStatsBefore.mtimeMs !== sourceStatsAfter.mtimeMs
  ) {
    throw new Error("The APK changed while its checksum was calculated");
  }

  const releaseNotes =
    options.notesFile !== undefined
      ? await readFile(resolve(options.notesFile), "utf8")
      : (options.notes ?? "");
  if (releaseNotes.length > 20_000) {
    throw new Error("Release notes must not exceed 20000 characters");
  }

  await mkdir(outputDirectory, { recursive: true });
  const safeVersionName =
    versionName
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "release";
  const fileName = [
    "gupiaomoniqi",
    safeVersionName,
    `v${versionCode}`,
    sha256.slice(0, 12),
  ].join("-") + ".apk";
  const destinationPath = join(outputDirectory, fileName);

  await publishApk(apkPath, destinationPath, {
    sha256,
    sizeBytes: sourceStatsAfter.size,
  });
  await atomicWrite(
    join(outputDirectory, `${fileName}.sha256`),
    `${sha256}  ${fileName}\n`,
  );

  const manifest = {
    packageName: PACKAGE_NAME,
    versionCode,
    versionName,
    apkFile: fileName,
    sha256,
    sizeBytes: sourceStatsAfter.size,
    publishedAt: new Date().toISOString(),
    mandatory: options.mandatory,
    releaseNotes,
  };
  await atomicWrite(
    join(outputDirectory, "latest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  console.log(
    JSON.stringify(
      {
        outputDirectory,
        manifest: join(outputDirectory, "latest.json"),
        apk: destinationPath,
        checksum: join(
          outputDirectory,
          `${fileName}.sha256`,
        ),
        release: manifest,
      },
      null,
      2,
    ),
  );
}

function parseArguments(args) {
  const options = {
    apk: undefined,
    out: undefined,
    versionCode: undefined,
    versionName: undefined,
    notes: undefined,
    notesFile: undefined,
    mandatory: false,
    help: false,
  };
  const valueOptions = new Map([
    ["--apk", "apk"],
    ["--out", "out"],
    ["--version-code", "versionCode"],
    ["--version-name", "versionName"],
    ["--notes", "notes"],
    ["--notes-file", "notesFile"],
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--mandatory") {
      const possibleBoolean = args[index + 1];
      if (possibleBoolean === "true" || possibleBoolean === "false") {
        options.mandatory = possibleBoolean === "true";
        index += 1;
      } else {
        options.mandatory = true;
      }
      continue;
    }
    if (argument.startsWith("--mandatory=")) {
      const value = argument.slice("--mandatory=".length);
      if (value !== "true" && value !== "false") {
        throw new Error("--mandatory must be true or false");
      }
      options.mandatory = value === "true";
      continue;
    }

    const equalsIndex = argument.indexOf("=");
    const optionName =
      equalsIndex === -1
        ? argument
        : argument.slice(0, equalsIndex);
    const property = valueOptions.get(optionName);
    if (!property) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value =
      equalsIndex === -1
        ? args[++index]
        : argument.slice(equalsIndex + 1);
    if (value === undefined) {
      throw new Error(`${optionName} requires a value`);
    }
    options[property] = value;
  }

  return options;
}

function required(value, optionName) {
  if (value === undefined || value === "") {
    throw new Error(`${optionName} is required`);
  }
  return value;
}

function parseVersionCode(value) {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error("--version-code must be a positive integer");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("--version-code exceeds the safe integer range");
  }
  return parsed;
}

async function publishApk(sourcePath, destinationPath, expected) {
  try {
    const existingStats = await stat(destinationPath);
    if (
      !existingStats.isFile() ||
      existingStats.size !== expected.sizeBytes ||
      (await hashFile(destinationPath)) !== expected.sha256
    ) {
      throw new Error(
        `Refusing to overwrite a different release file: ${destinationPath}`,
      );
    }
    return;
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  const temporaryPath = temporarySibling(destinationPath);
  try {
    await copyFile(sourcePath, temporaryPath);
    const copiedStats = await stat(temporaryPath);
    if (
      copiedStats.size !== expected.sizeBytes ||
      (await hashFile(temporaryPath)) !== expected.sha256
    ) {
      throw new Error("The copied APK failed integrity validation");
    }
    await syncFile(temporaryPath);
    await rename(temporaryPath, destinationPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function atomicWrite(destinationPath, content) {
  const temporaryPath = temporarySibling(destinationPath);
  try {
    await writeFile(temporaryPath, content, {
      encoding: "utf8",
      flag: "wx",
    });
    await syncFile(temporaryPath);
    await rename(temporaryPath, destinationPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function syncFile(path) {
  const handle = await open(path, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function temporarySibling(path) {
  return join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function isMissingFileError(error) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function printUsage() {
  console.log(`Usage:
  npm run android:update:publish -- \\
    --apk <app-release.apk> \\
    --out <update-directory> \\
    --version-code <positive-integer> \\
    --version-name <version> \\
    [--notes <text> | --notes-file <path>] \\
    [--mandatory[=true|false]]

The output directory defaults to APP_UPDATE_DIR or
server/data/app-updates. The APK and checksum are published before
latest.json, so a running server never advertises an incomplete release.`);
}
