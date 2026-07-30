import type { ReadStream } from "node:fs";

export const ANDROID_PACKAGE_NAME =
  "com.mengxinggg.gupiaomoniqi" as const;

export interface AndroidRelease {
  packageName: typeof ANDROID_PACKAGE_NAME;
  versionCode: number;
  versionName: string;
  apkPath: "/api/android/update/apk";
  sha256: string;
  sizeBytes: number;
  publishedAt: string;
  mandatory: boolean;
  releaseNotes: string;
}

export interface AndroidUpdateCheck {
  platform: "ANDROID";
  currentVersionCode: number;
  updateAvailable: boolean;
  release: AndroidRelease | null;
}

export interface AndroidApkDownload {
  release: AndroidRelease;
  fileName: string;
  etag: string;
  stream: ReadStream;
}
