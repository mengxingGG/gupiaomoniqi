import { execFile } from "node:child_process";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const EASTMONEY_HOST = "push2.eastmoney.com";
const EASTMONEY_ENDPOINT =
  `https://${EASTMONEY_HOST}/webguest/api/qt/clist/get`;
const QUOTE_TOKEN = "fa5fd1943c7b386f172d6893dbfba10b";
const PAGE_SIZE = 100;
const REQUEST_GAP_MS = 700;
const DEFAULT_EDGE_IPS = [
  "119.3.232.150",
  "120.76.218.228",
  "120.79.191.232",
];
let automaticFallback = null;
const PYTHON_JSON_FETCH_SCRIPT = String.raw`
import json
import ssl
import sys
import urllib.request

url = sys.argv[1]
referer = sys.argv[2]
timeout_seconds = float(sys.argv[3])

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
            "Chrome/138.0 Safari/537.36 EastmoneySeed/1.0"
        ),
    },
)

opener = urllib.request.build_opener(
    urllib.request.HTTPSHandler(context=ssl.create_default_context())
)

with opener.open(request, timeout=timeout_seconds) as response:
    payload = json.loads(response.read().decode("utf-8-sig"))

json.dump(payload, sys.stdout, ensure_ascii=False)
`.trim();
const FIELDS = [
  "f2",
  "f3",
  "f4",
  "f5",
  "f6",
  "f12",
  "f13",
  "f14",
  "f15",
  "f16",
  "f17",
  "f18",
  "f20",
  "f21",
  "f100",
].join(",");

const MARKET_CONFIGS = [
  {
    market: "CN",
    currency: "CNY",
    sourcePriceUnit: "CNY",
    priceScale: 1,
    sourcePage:
      "https://quote.eastmoney.com/center/gridlist.html#hs_a_board",
    filter:
      "m:0+t:6+f:!2,m:0+t:80+f:!2,m:1+t:2+f:!2,m:1+t:23+f:!2,m:0+t:81+s:262144+f:!2",
  },
  {
    market: "HK",
    currency: "HKD",
    sourcePriceUnit: "HKD",
    priceScale: 1,
    sourcePage:
      "https://quote.eastmoney.com/center/gridlist.html#hk_stocks",
    filter: "m:116+t:3,m:116+t:4,m:116+t:1,m:116+t:2",
  },
  {
    market: "US",
    currency: "USD",
    sourcePriceUnit: "USD",
    priceScale: 1,
    sourcePage:
      "https://quote.eastmoney.com/center/gridlist.html#us_stocks",
    filter: "m:105,m:106,m:107",
  },
  {
    market: "UK",
    currency: "GBP",
    sourcePriceUnit: "GBX",
    priceScale: 0.01,
    sourcePage:
      "https://quote.eastmoney.com/center/gridlist.html#stocks_all",
    filter:
      "m:155+t:1,m:155+t:2,m:155+t:3,m:156+t:1,m:156+t:2,m:156+t:5,m:156+t:6,m:156+t:7,m:156+t:8",
  },
];

function parseArguments(argv) {
  const options = {
    count: 300,
    output: "server/data/market-seeds.json",
    resolveIp: process.env.EASTMONEY_RESOLVE_IP,
    networkInterface: process.env.EASTMONEY_NETWORK_INTERFACE,
    edgeIps: parseEdgeIps(process.env.EASTMONEY_EDGE_IPS),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];

    if (argument === "--count" && value) {
      options.count = Number(value);
      index += 1;
    } else if (argument === "--output" && value) {
      options.output = value;
      index += 1;
    } else if (argument === "--resolve-ip" && value) {
      options.resolveIp = value;
      index += 1;
    } else if (argument === "--interface" && value) {
      options.networkInterface = value;
      index += 1;
    } else if (argument === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`未知参数：${argument}`);
    }
  }

  if (!Number.isSafeInteger(options.count) || options.count <= 0) {
    throw new Error("--count 必须是正整数");
  }

  return options;
}

function printHelp() {
  console.log(`
从东方财富行情中心抓取离线模拟股票种子。

用法：
  npm run data:seed
  npm run data:seed -- --count 300

选项：
  --count <数量>       每个市场保留的股票数量，默认 300
  --output <路径>      输出 JSON，默认 server/data/market-seeds.json
  --resolve-ip <IP>    DNS/代理异常时，将行情域名固定到指定边缘 IP
  --interface <地址>   curl 使用的本地网卡地址

也可通过 EASTMONEY_RESOLVE_IP 和 EASTMONEY_NETWORK_INTERFACE 设置后两项；
EASTMONEY_EDGE_IPS 可用逗号分隔的 IP 覆盖自动回退节点。
`);
}

function buildRequestUrl(config, pageNumber) {
  const parameters = new URLSearchParams({
    timil: "1",
    np: "1",
    fltt: "2",
    invt: "2",
    pn: String(pageNumber),
    pz: String(PAGE_SIZE),
    po: "1",
    fid: "f20",
    dect: "1",
    ut: QUOTE_TOKEN,
    wbp2u: "|0|0|0|web",
    fs: config.filter,
    fields: FIELDS,
  });

  return `${EASTMONEY_ENDPOINT}?${parameters.toString()}`;
}

async function requestJson(url, config, options) {
  if (options.resolveIp) {
    return requestJsonWithCurl(url, config, options);
  }

  if (automaticFallback?.transport === "curl") {
    return requestJsonWithCurl(url, config, {
      ...options,
      resolveIp: automaticFallback.resolveIp,
    });
  }
  if (automaticFallback?.transport === "python") {
    return requestJsonWithPython(url, config);
  }

  try {
    return await requestJsonWithNodeFetch(url, config);
  } catch (nodeError) {
    try {
      const payload = await requestJsonWithCurl(url, config, options);
      automaticFallback = { transport: "curl", resolveIp: undefined };
      console.warn(
        "Node fetch 不可用，已自动切换到 curl 兼容通道。",
      );
      return payload;
    } catch (curlError) {
      const edgeErrors = [];
      for (const edgeIp of options.edgeIps) {
        try {
          const payload = await requestJsonWithCurl(url, config, {
            ...options,
            resolveIp: edgeIp,
          });
          automaticFallback = { transport: "curl", resolveIp: edgeIp };
          console.warn(
            `默认网络路径不可用，已自动切换到东财边缘节点 ${edgeIp}。`,
          );
          return payload;
        } catch (edgeError) {
          edgeErrors.push(`${edgeIp}: ${errorMessage(edgeError)}`);
        }
      }

      try {
        const payload = await requestJsonWithPython(url, config);
        automaticFallback = { transport: "python" };
        console.warn(
          "Node fetch 与 curl 均不可用，已自动切换到 Python 兼容通道。",
        );
        return payload;
      } catch (pythonError) {
        throw new Error(
          [
            `东财请求失败：${errorMessage(nodeError)}`,
            `curl 回退失败：${errorMessage(curlError)}`,
            `边缘节点回退失败：${edgeErrors.join(" | ")}`,
            `Python 回退失败：${errorMessage(pythonError)}`,
          ].join("\n"),
        );
      }
    }
  }
}

function parseEdgeIps(value) {
  const candidates = value
    ? value.split(",").map((item) => item.trim())
    : DEFAULT_EDGE_IPS;
  return candidates.filter((item) =>
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(item),
  );
}

async function requestJsonWithNodeFetch(url, config) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json,text/plain,*/*",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        referer: config.sourcePage,
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function requestJsonWithCurl(url, config, options) {
  const executable = process.platform === "win32" ? "curl.exe" : "curl";
  const argumentsList = [
    "--silent",
    "--show-error",
    "--fail-with-body",
    "--location",
    "--max-time",
    "25",
    "--header",
    "accept: application/json,text/plain,*/*",
    "--header",
    "accept-language: zh-CN,zh;q=0.9,en;q=0.8",
    "--user-agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36",
    "--referer",
    config.sourcePage,
  ];

  if (options.resolveIp) {
    argumentsList.push(
      "--resolve",
      `${EASTMONEY_HOST}:443:${options.resolveIp}`,
      "--resolve",
      `push2delay.eastmoney.com:443:${options.resolveIp}`,
    );
  }

  if (options.networkInterface) {
    argumentsList.push("--interface", options.networkInterface);
  }

  argumentsList.push(url);

  const { stdout } = await execFileAsync(executable, argumentsList, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });

  return JSON.parse(stdout);
}

async function requestJsonWithPython(url, config) {
  const candidates =
    process.platform === "win32"
      ? [
          { command: "py", args: ["-3"] },
          { command: "python", args: [] },
          { command: "python3", args: [] },
        ]
      : [
          { command: "python3", args: [] },
          { command: "python", args: [] },
        ];
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const { stdout } = await execFileAsync(
        candidate.command,
        [
          ...candidate.args,
          "-c",
          PYTHON_JSON_FETCH_SCRIPT,
          url,
          config.sourcePage,
          "25",
        ],
        {
          encoding: "utf8",
          maxBuffer: 20 * 1024 * 1024,
          timeout: 26_000,
          windowsHide: true,
        },
      );
      return JSON.parse(stdout);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("未找到可用的 Python 3");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function scalePrice(value, scale) {
  const number = finiteNumber(value);
  return number === null
    ? null
    : Math.round((number * scale + Number.EPSILON) * 10_000) / 10_000;
}

function normalizeInstrument(row, config) {
  const symbol = typeof row.f12 === "string" ? row.f12.trim() : "";
  const name = typeof row.f14 === "string" ? row.f14.trim() : "";
  const sourceInitialPrice = finiteNumber(row.f2);
  const currentPrice = scalePrice(row.f2, config.priceScale);
  const previousClose = scalePrice(row.f18, config.priceScale);

  if (!symbol || !name || !currentPrice || currentPrice <= 0) {
    return null;
  }

  const safeSymbol = symbol
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return {
    id: `${config.market.toLowerCase()}-${safeSymbol}`,
    symbol,
    name,
    market: config.market,
    currency: config.currency,
    industry:
      typeof row.f100 === "string" && row.f100.trim()
        ? row.f100.trim()
        : "未分类",
    sourceMarketCode: finiteNumber(row.f13),
    sourceSecid: `${row.f13}.${symbol}`,
    sourcePriceUnit: config.sourcePriceUnit,
    sourceInitialPrice,
    initialPrice: currentPrice,
    previousClose:
      previousClose && previousClose > 0 ? previousClose : currentPrice,
    openPrice: scalePrice(row.f17, config.priceScale),
    highPrice: scalePrice(row.f15, config.priceScale),
    lowPrice: scalePrice(row.f16, config.priceScale),
    volume: finiteNumber(row.f5) ?? 0,
    turnover: finiteNumber(row.f6) ?? 0,
    totalMarketCap: finiteNumber(row.f20),
    circulatingMarketCap: finiteNumber(row.f21),
  };
}

async function fetchMarket(config, targetCount, options) {
  const instruments = [];
  const seenSymbols = new Set();
  let pageNumber = 1;
  let pagesFetched = 0;
  let reportedTotal = null;

  while (instruments.length < targetCount && pageNumber <= 30) {
    const url = buildRequestUrl(config, pageNumber);
    const payload = await requestJson(url, config, options);
    const rows = payload?.data?.diff;

    if (payload?.rc !== 0 || !Array.isArray(rows)) {
      throw new Error(
        `${config.market} 第 ${pageNumber} 页响应格式异常：${JSON.stringify(payload).slice(0, 300)}`,
      );
    }

    reportedTotal = finiteNumber(payload.data.total) ?? reportedTotal;
    pagesFetched = pageNumber;

    for (const row of rows) {
      const instrument = normalizeInstrument(row, config);

      if (!instrument || seenSymbols.has(instrument.symbol)) {
        continue;
      }

      seenSymbols.add(instrument.symbol);
      instruments.push(instrument);

      if (instruments.length === targetCount) {
        break;
      }
    }

    console.log(
      `${config.market}: 第 ${pageNumber} 页完成，已取得 ${instruments.length}/${targetCount}`,
    );

    if (rows.length < PAGE_SIZE) {
      break;
    }

    pageNumber += 1;
    await delay(REQUEST_GAP_MS);
  }

  if (instruments.length < targetCount) {
    throw new Error(
      `${config.market} 只有 ${instruments.length} 条有效股票，未达到 ${targetCount} 条目标`,
    );
  }

  return {
    instruments,
    reportedTotal,
    pagesFetched,
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const outputPath = path.resolve(process.cwd(), options.output);
  const fetchedAt = new Date().toISOString();
  const instruments = [];
  const markets = {};

  console.log(
    `开始抓取，每个市场 ${options.count} 只，输出 ${outputPath}`,
  );

  for (let index = 0; index < MARKET_CONFIGS.length; index += 1) {
    const config = MARKET_CONFIGS[index];
    const result = await fetchMarket(config, options.count, options);
    instruments.push(...result.instruments);
    markets[config.market] = {
      count: result.instruments.length,
      reportedTotal: result.reportedTotal,
      currency: config.currency,
      sourcePriceUnit: config.sourcePriceUnit,
      sourcePage: config.sourcePage,
      pagesFetched: result.pagesFetched,
    };

    if (index < MARKET_CONFIGS.length - 1) {
      await delay(REQUEST_GAP_MS);
    }
  }

  const snapshot = {
    schemaVersion: 1,
    source: "Eastmoney quote center webguest",
    sourceHost: EASTMONEY_HOST,
    fetchedAt,
    selection: "totalMarketCapDesc",
    requestedPerMarket: options.count,
    markets,
    instruments,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryOutputPath =
    `${outputPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(
      temporaryOutputPath,
      `${JSON.stringify(snapshot, null, 2)}\n`,
      "utf8",
    );
    await rename(temporaryOutputPath, outputPath);
  } finally {
    await rm(temporaryOutputPath, { force: true });
  }

  console.log(
    `完成：共 ${instruments.length} 只，${Object.entries(markets)
      .map(([market, value]) => `${market} ${value.count}`)
      .join(" / ")}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
