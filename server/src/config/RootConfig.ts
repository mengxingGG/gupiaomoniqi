import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { z } from "zod";

const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;

const llmTradingSchema = z
  .object({
    enabled: z.boolean().default(true),
    baseUrl: z.string().trim().url(),
    modelId: z.string().trim().min(1).max(300),
    apiKey: z.string().default(""),
    jsonSchemaMode: z.enum(["object", "strict"]).default("object"),
    agentCount: z.coerce.number().int().min(1).max(10).default(10),
    contextWindow: z.coerce
      .number()
      .int()
      .min(8_192)
      .max(1_048_576)
      .default(32_768),
    requestTimeoutMs: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(900_000)
      .default(DEFAULT_REQUEST_TIMEOUT_MS),
    decisionIntervalMs: z.coerce
      .number()
      .int()
      .min(10_000)
      .max(24 * 60 * 60_000)
      .default(60_000),
    maxConcurrency: z.coerce.number().int().min(1).max(2).default(1),
    maxOutputTokens: z.coerce.number().int().min(128).max(4_096).default(512),
    temperature: z.coerce.number().min(0).max(2).default(0.35),
    circuitBackoffMs: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(30 * 60_000)
      .default(60_000),
    circuitMaximumBackoffMs: z.coerce
      .number()
      .int()
      .min(10_000)
      .max(60 * 60_000)
      .default(300_000),
  })
  .strict();

const smtpSchema = z
  .object({
    enabled: z.boolean().default(true),
    host: z.string().trim().min(1).max(253),
    port: z.coerce.number().int().min(1).max(65_535).default(465),
    secure: z.boolean().default(true),
    requireTls: z.boolean().optional(),
    user: z.string().trim().min(1).max(320).optional(),
    pass: z.string().min(1).max(1_000).optional(),
    from: z.string().trim().min(3).max(320),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.user === undefined) !== (value.pass === undefined)) {
      context.addIssue({
        code: "custom",
        path: [value.user === undefined ? "user" : "pass"],
        message: "smtp.user 与 smtp.pass 必须同时配置",
      });
    }
  });

const rootConfigSchema = z
  .object({
    llmTrading: z.unknown().optional(),
    smtp: z.unknown().optional(),
  })
  .passthrough();

export interface LLMTradingConfig {
  enabled: true;
  baseUrl: string;
  modelId: string;
  apiKey: string;
  jsonSchemaMode: "object" | "strict";
  agentCount: number;
  contextWindow: number;
  requestTimeoutMs: number;
  decisionIntervalMs: number;
  maxConcurrency: number;
  maxOutputTokens: number;
  temperature: number;
  circuitBackoffMs: number;
  circuitMaximumBackoffMs: number;
}

export interface SmtpConfig {
  enabled: true;
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  user?: string;
  pass?: string;
  from: string;
}

export type RootConfigState = "ENABLED" | "DISABLED" | "MISSING" | "INVALID";

export interface RootConfigResult {
  path: string;
  state: RootConfigState;
  llmTrading: LLMTradingConfig | null;
  error: string | null;
  smtpState: RootConfigState;
  smtp: SmtpConfig | null;
  smtpError: string | null;
}

export interface LoadRootConfigOptions {
  path?: string;
  readText?: (path: string) => Promise<string>;
}

export async function loadRootConfig(
  options: LoadRootConfigOptions = {},
): Promise<RootConfigResult> {
  const path = resolveRootConfigPath(options.path);
  const readText = options.readText ?? ((candidate: string) => readFile(candidate, "utf8"));
  let source: string;

  try {
    source = await readText(path);
  } catch (error) {
    if (isMissingFile(error)) {
      return disabledResult(path, "MISSING", null);
    }
    return disabledResult(path, "INVALID", safeErrorMessage(error));
  }

  return parseRootConfig(source, path);
}

export function parseRootConfig(
  source: string,
  path = resolveRootConfigPath(),
): RootConfigResult {
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(source.replace(/^\uFEFF/u, ""));
  } catch (error) {
    return disabledResult(path, "INVALID", `配置不是有效 JSON：${safeErrorMessage(error)}`);
  }

  const root = rootConfigSchema.safeParse(parsedJson);
  if (!root.success) {
    return disabledResult(path, "INVALID", formatZodError(root.error));
  }

  return {
    path,
    ...parseLlmTrading(root.data.llmTrading),
    ...parseSmtp(root.data.smtp),
  };
}

export function resolveRootConfigPath(path?: string): string {
  return resolve(
    path ??
      process.env.APP_CONFIG_PATH ??
      resolve(process.cwd(), "config.json"),
  );
}

function parseLlmTrading(value: unknown): Pick<
  RootConfigResult,
  "state" | "llmTrading" | "error"
> {
  if (value === undefined || value === null || isExplicitlyDisabled(value)) {
    return { state: "DISABLED", llmTrading: null, error: null };
  }

  const llm = llmTradingSchema.safeParse(value);
  if (!llm.success) {
    return {
      state: "INVALID",
      llmTrading: null,
      error: formatZodError(llm.error),
    };
  }

  const endpoint = new URL(llm.data.baseUrl);
  const protocol = endpoint.protocol;
  if (protocol !== "http:" && protocol !== "https:") {
    return invalidLlm("llmTrading.baseUrl 只支持 http 或 https");
  }
  if (endpoint.username || endpoint.password) {
    return invalidLlm("llmTrading.baseUrl 不允许包含用户名或密码");
  }
  if (protocol === "http:" && !isPrivateHost(endpoint.hostname)) {
    return invalidLlm(
      "公网 LLM 地址必须使用 https；http 仅允许本机或局域网地址",
    );
  }
  if (llm.data.circuitMaximumBackoffMs < llm.data.circuitBackoffMs) {
    return invalidLlm(
      "llmTrading.circuitMaximumBackoffMs 不能小于 circuitBackoffMs",
    );
  }

  return {
    state: "ENABLED",
    llmTrading: {
      ...llm.data,
      enabled: true,
      baseUrl: llm.data.baseUrl.replace(/\/+$/u, ""),
      apiKey: llm.data.apiKey.trim(),
    },
    error: null,
  };
}

function parseSmtp(value: unknown): Pick<
  RootConfigResult,
  "smtpState" | "smtp" | "smtpError"
> {
  if (value === undefined || value === null || isExplicitlyDisabled(value)) {
    return { smtpState: "DISABLED", smtp: null, smtpError: null };
  }

  const smtp = smtpSchema.safeParse(value);
  if (!smtp.success) {
    return {
      smtpState: "INVALID",
      smtp: null,
      smtpError: formatZodError(smtp.error),
    };
  }

  return {
    smtpState: "ENABLED",
    smtp: {
      ...smtp.data,
      enabled: true,
      requireTls: smtp.data.requireTls ?? !smtp.data.secure,
    },
    smtpError: null,
  };
}

function isExplicitlyDisabled(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "enabled" in value &&
    (value as { enabled?: unknown }).enabled === false
  );
}

function invalidLlm(
  error: string,
): Pick<RootConfigResult, "state" | "llmTrading" | "error"> {
  return { state: "INVALID", llmTrading: null, error };
}

function disabledResult(
  path: string,
  state: Exclude<RootConfigState, "ENABLED">,
  error: string | null,
): RootConfigResult {
  return {
    path,
    state,
    llmTrading: null,
    error,
    smtpState: state,
    smtp: null,
    smtpError: error,
  };
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, 4)
    .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
    .join("；");
}

function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (normalized === "localhost") {
    return true;
  }
  const ipVersion = isIP(normalized);
  if (ipVersion === 6) {
    return (
      normalized === "::1" ||
      /^f[cd][0-9a-f]{2}:/u.test(normalized) ||
      /^fe[89ab][0-9a-f]:/u.test(normalized)
    );
  }
  if (ipVersion !== 4) {
    return false;
  }
  const octets = normalized.split(".").map(Number);
  return (
    octets[0] === 127 ||
    octets[0] === 10 ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31)
  );
}
