import { spawn } from "node:child_process";

const PYTHON_SCRIPT = `
import json
import ssl
import sys
import urllib.request

url = sys.argv[1]
referer = sys.argv[2]
timeout_seconds = float(sys.argv[3]) / 1000.0

request = urllib.request.Request(
    url,
    method="GET",
    headers={
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Referer": referer,
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/138.0 Safari/537.36 EastmoneyProbe/1.0"
        ),
    },
)

opener = urllib.request.build_opener(
    urllib.request.HTTPSHandler(context=ssl.create_default_context())
)

with opener.open(request, timeout=timeout_seconds) as response:
    body = response.read()

payload = json.loads(body.decode("utf-8-sig"))
json.dump(payload, sys.stdout, ensure_ascii=False)
`.trim();

let windowsPythonCandidatesPromise:
  | Promise<
      Array<{
        command: string;
        args: string[];
      }>
    >
  | null = null;

export async function requestJsonViaPython(
  url: string,
  referer: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const attempts = await pythonCommandCandidates();
  let lastError: Error | null = null;

  for (const candidate of attempts) {
    try {
      const stdout = await runPython(candidate, url, referer, timeoutMs);
      const payload = JSON.parse(stdout) as unknown;
      if (!isObject(payload)) {
        throw new Error("Python fallback did not return a JSON object");
      }
      return payload;
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("Python fallback unavailable");
}

async function pythonCommandCandidates(): Promise<Array<{
  command: string;
  args: string[];
}>> {
  if (process.platform === "win32") {
    if (!windowsPythonCandidatesPromise) {
      windowsPythonCandidatesPromise = resolveWindowsPythonCandidates();
    }
    return windowsPythonCandidatesPromise;
  }
  return [
    { command: "python3", args: [] },
    { command: "python", args: [] },
  ];
}

async function resolveWindowsPythonCandidates(): Promise<
  Array<{
    command: string;
    args: string[];
  }>
> {
  const resolved = await runProcess("where.exe", ["python"], 3_000).catch(
    () => "",
  );
  const candidates = resolved
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.includes("\\WindowsApps\\"))
    .map((line) => ({ command: line, args: [] }));

  return [
    ...candidates,
    { command: "py", args: ["-3"] },
    { command: "python", args: [] },
    { command: "python3", args: [] },
  ];
}

async function runPython(
  candidate: { command: string; args: string[] },
  url: string,
  referer: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      candidate.command,
      [...candidate.args, "-c", PYTHON_SCRIPT, url, referer, String(timeoutMs)],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      reject(new Error(`${candidate.command} fallback timed out`));
    }, timeoutMs + 1_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(
        new Error(
          stderr.trim() || `${candidate.command} exited with code ${code}`,
        ),
      );
    });
  });
}

async function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      reject(new Error(`${command} timed out`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
