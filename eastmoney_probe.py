#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
东方财富公开行情接口探测脚本。

用途：
1. 验证沪深、港股、美股、英股列表是否可读取；
2. 验证单股报价、日 K、分时数据是否可读取；
3. 观察行情字段是否随时间变化；
4. 测试批量轮询和有限强度的高频请求；
5. 生成可直接交给开发者分析的 .log 与 .json。

脚本只执行公开 GET 请求，不登录、不下单、不写项目数据库。
仅依赖 Python 标准库，建议 Python 3.10 或更高版本。
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import logging
import math
import os
import platform
import socket
import ssl
import statistics
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


SCRIPT_VERSION = "1.0.0"
PUBLIC_QUOTE_TOKEN = "fa5fd1943c7b386f172d6893dbfba10b"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/138.0 Safari/537.36 EastmoneyProbe/1.0"
)
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
DEFAULT_QPS = "1,5,10,20"

LIST_ENDPOINTS = (
    (
        "webguest",
        "https://push2.eastmoney.com/webguest/api/qt/clist/get",
    ),
    (
        "standard",
        "https://push2.eastmoney.com/api/qt/clist/get",
    ),
)
QUOTE_ENDPOINT = "https://push2.eastmoney.com/api/qt/stock/get"
KLINE_ENDPOINT = (
    "https://push2his.eastmoney.com/api/qt/stock/kline/get"
)
TRENDS_ENDPOINT = (
    "https://push2his.eastmoney.com/api/qt/stock/trends2/get"
)

LIST_FIELDS = ",".join(
    (
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
        "f124",
    )
)

MARKETS: dict[str, dict[str, str]] = {
    "CN": {
        "name": "沪深",
        "referer": (
            "https://quote.eastmoney.com/center/"
            "gridlist.html#hs_a_board"
        ),
        "filter": (
            "m:0+t:6+f:!2,m:0+t:80+f:!2,"
            "m:1+t:2+f:!2,m:1+t:23+f:!2,"
            "m:0+t:81+s:262144+f:!2"
        ),
    },
    "HK": {
        "name": "港股",
        "referer": (
            "https://quote.eastmoney.com/center/"
            "gridlist.html#hk_stocks"
        ),
        "filter": "m:116+t:3,m:116+t:4,m:116+t:1,m:116+t:2",
    },
    "US": {
        "name": "美股",
        "referer": (
            "https://quote.eastmoney.com/center/"
            "gridlist.html#us_stocks"
        ),
        "filter": "m:105,m:106,m:107",
    },
    "UK": {
        "name": "英股",
        "referer": (
            "https://quote.eastmoney.com/center/"
            "gridlist.html#stocks_all"
        ),
        "filter": (
            "m:155+t:1,m:155+t:2,m:155+t:3,"
            "m:156+t:1,m:156+t:2,m:156+t:5,"
            "m:156+t:6,m:156+t:7,m:156+t:8"
        ),
    },
}


@dataclass
class HttpResult:
    ok: bool
    status: int | None
    elapsed_ms: float
    response_bytes: int
    payload: Any = None
    error_type: str | None = None
    error: str | None = None
    content_type: str | None = None

    def public_summary(self) -> dict[str, Any]:
        value = asdict(self)
        value.pop("payload", None)
        return value


class ProbeTransport:
    """线程安全使用的无状态 urllib 请求封装。"""

    def __init__(
        self,
        timeout: float,
        proxy: str | None,
        no_system_proxy: bool,
    ) -> None:
        self.timeout = timeout
        handlers: list[Any] = [
            urllib.request.HTTPSHandler(
                context=ssl.create_default_context(),
            )
        ]

        if proxy:
            handlers.append(
                urllib.request.ProxyHandler(
                    {"http": proxy, "https": proxy}
                )
            )
        elif no_system_proxy:
            handlers.append(urllib.request.ProxyHandler({}))

        self.opener = urllib.request.build_opener(*handlers)

    def get_json(
        self,
        url: str,
        referer: str,
        *,
        cache_bust: bool = True,
    ) -> HttpResult:
        request_url = add_cache_buster(url) if cache_bust else url
        request = urllib.request.Request(
            request_url,
            method="GET",
            headers={
                "Accept": "application/json,text/plain,*/*",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
                "Referer": referer,
                "User-Agent": USER_AGENT,
            },
        )
        started = time.perf_counter()

        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                elapsed_ms = (time.perf_counter() - started) * 1000
                status = getattr(response, "status", None)
                content_type = response.headers.get("Content-Type")

                if len(raw) > MAX_RESPONSE_BYTES:
                    return HttpResult(
                        ok=False,
                        status=status,
                        elapsed_ms=elapsed_ms,
                        response_bytes=len(raw),
                        error_type="RESPONSE_TOO_LARGE",
                        error=(
                            f"响应超过 {MAX_RESPONSE_BYTES} 字节安全上限"
                        ),
                        content_type=content_type,
                    )

                if not raw:
                    return HttpResult(
                        ok=False,
                        status=status,
                        elapsed_ms=elapsed_ms,
                        response_bytes=0,
                        error_type="EMPTY_RESPONSE",
                        error="HTTP 成功但响应体为空",
                        content_type=content_type,
                    )

                try:
                    payload = json.loads(raw.decode("utf-8-sig"))
                except (UnicodeDecodeError, json.JSONDecodeError) as error:
                    snippet = raw[:240].decode(
                        "utf-8", errors="replace"
                    )
                    return HttpResult(
                        ok=False,
                        status=status,
                        elapsed_ms=elapsed_ms,
                        response_bytes=len(raw),
                        error_type="INVALID_JSON",
                        error=f"{error}; body={snippet!r}",
                        content_type=content_type,
                    )

                semantic_ok = (
                    isinstance(payload, dict)
                    and payload.get("rc") == 0
                    and payload.get("data") is not None
                )
                return HttpResult(
                    ok=semantic_ok,
                    status=status,
                    elapsed_ms=elapsed_ms,
                    response_bytes=len(raw),
                    payload=payload,
                    error_type=None if semantic_ok else "API_REJECTED",
                    error=(
                        None
                        if semantic_ok
                        else summarize_api_rejection(payload)
                    ),
                    content_type=content_type,
                )
        except urllib.error.HTTPError as error:
            elapsed_ms = (time.perf_counter() - started) * 1000
            try:
                raw = error.read(2048)
            except Exception:
                raw = b""
            snippet = raw.decode("utf-8", errors="replace")[:240]
            return HttpResult(
                ok=False,
                status=error.code,
                elapsed_ms=elapsed_ms,
                response_bytes=len(raw),
                error_type="HTTP_ERROR",
                error=f"HTTP {error.code}; body={snippet!r}",
                content_type=error.headers.get("Content-Type"),
            )
        except urllib.error.URLError as error:
            elapsed_ms = (time.perf_counter() - started) * 1000
            reason = getattr(error, "reason", error)
            return HttpResult(
                ok=False,
                status=None,
                elapsed_ms=elapsed_ms,
                response_bytes=0,
                error_type=type(reason).__name__.upper(),
                error=str(reason),
            )
        except (TimeoutError, socket.timeout) as error:
            elapsed_ms = (time.perf_counter() - started) * 1000
            return HttpResult(
                ok=False,
                status=None,
                elapsed_ms=elapsed_ms,
                response_bytes=0,
                error_type="TIMEOUT",
                error=str(error) or "请求超时",
            )
        except Exception as error:
            elapsed_ms = (time.perf_counter() - started) * 1000
            return HttpResult(
                ok=False,
                status=None,
                elapsed_ms=elapsed_ms,
                response_bytes=0,
                error_type=type(error).__name__.upper(),
                error=str(error),
            )


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "探测东方财富四市场列表、报价、K 线、更新频率和限流。"
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parent,
        help="日志与 JSON 结果输出目录",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=10.0,
        help="单个 HTTP 请求超时秒数",
    )
    parser.add_argument(
        "--qps",
        default=DEFAULT_QPS,
        help="高频阶段，每秒请求数列表",
    )
    parser.add_argument(
        "--duration",
        type=float,
        default=5.0,
        help="每个 QPS 档位持续秒数",
    )
    parser.add_argument(
        "--observe-seconds",
        type=float,
        default=15.0,
        help="四市场样本报价变化观察时长",
    )
    parser.add_argument(
        "--observe-interval",
        type=float,
        default=1.0,
        help="样本报价观察间隔秒数",
    )
    parser.add_argument(
        "--batch-cycles",
        type=int,
        default=4,
        help="四市场批量轮询次数",
    )
    parser.add_argument(
        "--batch-interval",
        type=float,
        default=3.0,
        help="四市场批量轮询间隔秒数",
    )
    parser.add_argument(
        "--page-size",
        type=int,
        default=100,
        help="股票列表单页请求条数",
    )
    parser.add_argument(
        "--target-per-market",
        type=int,
        default=300,
        help="每个市场实际探测的股票目标数",
    )
    parser.add_argument(
        "--proxy",
        default=None,
        help=(
            "显式 HTTP/HTTPS 代理，例如 "
            "http://127.0.0.1:7890；日志会隐藏账号密码"
        ),
    )
    parser.add_argument(
        "--no-system-proxy",
        action="store_true",
        help="忽略操作系统代理设置，强制直连",
    )
    parser.add_argument(
        "--skip-load",
        action="store_true",
        help="跳过高频请求阶段，只验证数据接口",
    )
    parser.add_argument(
        "--quick",
        action="store_true",
        help="约 15 秒的快速模式",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="在日志中写入更多诊断信息",
    )
    parser.add_argument(
        "--pause",
        action="store_true",
        help="结束后等待按回车，适合双击运行",
    )
    arguments = parser.parse_args()
    try:
        arguments.qps_values = parse_qps(arguments.qps)
    except argparse.ArgumentTypeError as error:
        parser.error(str(error))

    if not 1 <= arguments.timeout <= 60:
        parser.error("--timeout 必须在 1 到 60 秒之间")
    if not 0.5 <= arguments.duration <= 30:
        parser.error("--duration 必须在 0.5 到 30 秒之间")
    if not 0 <= arguments.observe_seconds <= 300:
        parser.error("--observe-seconds 必须在 0 到 300 秒之间")
    if not 0.2 <= arguments.observe_interval <= 60:
        parser.error("--observe-interval 必须在 0.2 到 60 秒之间")
    if not 0 <= arguments.batch_cycles <= 30:
        parser.error("--batch-cycles 必须在 0 到 30 之间")
    if not 0.5 <= arguments.batch_interval <= 60:
        parser.error("--batch-interval 必须在 0.5 到 60 秒之间")
    if not 1 <= arguments.page_size <= 500:
        parser.error("--page-size 必须在 1 到 500 之间")
    if not 1 <= arguments.target_per_market <= 1000:
        parser.error("--target-per-market 必须在 1 到 1000 之间")
    if arguments.proxy and arguments.no_system_proxy:
        parser.error("--proxy 与 --no-system-proxy 不能同时使用")

    if arguments.quick:
        arguments.qps_values = [1, 5]
        arguments.duration = 2.0
        arguments.observe_seconds = 5.0
        arguments.batch_cycles = 2
        arguments.batch_interval = 1.0

    return arguments


def parse_qps(value: str) -> list[int]:
    try:
        qps_values = sorted(
            {
                int(item.strip())
                for item in value.split(",")
                if item.strip()
            }
        )
    except ValueError as error:
        raise argparse.ArgumentTypeError(
            "--qps 必须是逗号分隔的整数"
        ) from error

    if not qps_values:
        raise argparse.ArgumentTypeError("--qps 不能为空")
    if qps_values[0] < 1 or qps_values[-1] > 50:
        raise argparse.ArgumentTypeError(
            "为避免给公开接口造成过大压力，QPS 只允许 1 到 50"
        )
    return qps_values


def configure_logging(
    output_directory: Path,
    run_id: str,
    debug: bool,
) -> tuple[logging.Logger, Path]:
    output_directory.mkdir(parents=True, exist_ok=True)
    log_path = output_directory / f"eastmoney_probe_{run_id}.log"
    logger = logging.getLogger("eastmoney_probe")
    logger.handlers.clear()
    logger.setLevel(logging.DEBUG)
    formatter = logging.Formatter(
        "%(asctime)s.%(msecs)03d %(levelname)-7s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    file_handler = logging.FileHandler(
        log_path,
        encoding="utf-8",
    )
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.DEBUG if debug else logging.INFO)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)
    return logger, log_path


def add_cache_buster(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    query = urllib.parse.parse_qsl(
        parsed.query,
        keep_blank_values=True,
    )
    query.append(("_probe", str(time.time_ns())))
    return urllib.parse.urlunsplit(
        (
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            urllib.parse.urlencode(query),
            parsed.fragment,
        )
    )


def build_url(endpoint: str, parameters: dict[str, Any]) -> str:
    return f"{endpoint}?{urllib.parse.urlencode(parameters)}"


def build_list_url(
    endpoint: str,
    market: str,
    page_size: int,
    page: int = 1,
) -> str:
    return build_url(
        endpoint,
        {
            "timil": "1",
            "np": "1",
            "fltt": "2",
            "invt": "2",
            "pn": page,
            "pz": page_size,
            "po": "1",
            "fid": "f20",
            "dect": "1",
            "ut": PUBLIC_QUOTE_TOKEN,
            "wbp2u": "|0|0|0|web",
            "fs": MARKETS[market]["filter"],
            "fields": LIST_FIELDS,
        },
    )


def build_quote_url(secid: str) -> str:
    return build_url(
        QUOTE_ENDPOINT,
        {
            "secid": secid,
            "fltt": "2",
            "invt": "2",
            "ut": PUBLIC_QUOTE_TOKEN,
            "fields": ",".join(
                (
                    "f43",
                    "f44",
                    "f45",
                    "f46",
                    "f47",
                    "f48",
                    "f57",
                    "f58",
                    "f60",
                    "f86",
                    "f124",
                    "f169",
                    "f170",
                )
            ),
        },
    )


def build_kline_url(secid: str) -> str:
    return build_url(
        KLINE_ENDPOINT,
        {
            "secid": secid,
            "ut": PUBLIC_QUOTE_TOKEN,
            "fields1": "f1,f2,f3,f4,f5,f6",
            "fields2": (
                "f51,f52,f53,f54,f55,f56,"
                "f57,f58,f59,f60,f61"
            ),
            "klt": "101",
            "fqt": "1",
            "beg": "0",
            "end": "20500101",
            "lmt": "30",
        },
    )


def build_trends_url(secid: str) -> str:
    return build_url(
        TRENDS_ENDPOINT,
        {
            "secid": secid,
            "ut": PUBLIC_QUOTE_TOKEN,
            "fields1": (
                "f1,f2,f3,f4,f5,f6,f7,"
                "f8,f9,f10,f11,f12,f13"
            ),
            "fields2": "f51,f52,f53,f54,f55,f56,f57,f58",
            "ndays": "1",
            "iscr": "0",
            "iscca": "0",
        },
    )


def summarize_api_rejection(payload: Any) -> str:
    if not isinstance(payload, dict):
        return f"响应 JSON 类型为 {type(payload).__name__}"
    return (
        f"rc={payload.get('rc')!r}, "
        f"rt={payload.get('rt')!r}, "
        f"message={payload.get('message')!r}, "
        f"data={'present' if payload.get('data') is not None else 'null'}"
    )


def redacted_proxy(proxy: str | None) -> str | None:
    if not proxy:
        return None
    try:
        parsed = urllib.parse.urlsplit(proxy)
        host = parsed.hostname or ""
        port = f":{parsed.port}" if parsed.port else ""
        return urllib.parse.urlunsplit(
            (parsed.scheme, f"{host}{port}", "", "", "")
        )
    except Exception:
        return "<已配置，无法安全显示>"


def system_proxy_summary() -> dict[str, str]:
    summary: dict[str, str] = {}
    for key, value in urllib.request.getproxies().items():
        if key.lower() not in {"http", "https"}:
            continue
        summary[key.lower()] = redacted_proxy(value) or ""
    return summary


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def percentile(values: list[float], percent: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return round(ordered[0], 2)
    rank = (len(ordered) - 1) * percent
    lower = math.floor(rank)
    upper = math.ceil(rank)
    if lower == upper:
        return round(ordered[lower], 2)
    weight = rank - lower
    return round(
        ordered[lower] * (1 - weight) + ordered[upper] * weight,
        2,
    )


def latency_summary(values: Iterable[float]) -> dict[str, float | None]:
    samples = list(values)
    if not samples:
        return {
            "min_ms": None,
            "mean_ms": None,
            "p50_ms": None,
            "p95_ms": None,
            "p99_ms": None,
            "max_ms": None,
        }
    return {
        "min_ms": round(min(samples), 2),
        "mean_ms": round(statistics.fmean(samples), 2),
        "p50_ms": percentile(samples, 0.50),
        "p95_ms": percentile(samples, 0.95),
        "p99_ms": percentile(samples, 0.99),
        "max_ms": round(max(samples), 2),
    }


def sample_instrument(row: dict[str, Any]) -> dict[str, Any]:
    market_code = row.get("f13")
    symbol = str(row.get("f12") or "").strip()
    secid = (
        f"{market_code}.{symbol}"
        if market_code is not None and symbol
        else None
    )
    return {
        "secid": secid,
        "symbol": symbol,
        "name": str(row.get("f14") or "").strip(),
        "price": row.get("f2"),
        "change_percent": row.get("f3"),
        "volume": row.get("f5"),
        "quote_epoch": row.get("f124"),
    }


def extract_rows(result: HttpResult) -> list[dict[str, Any]]:
    if not result.ok or not isinstance(result.payload, dict):
        return []
    data = result.payload.get("data")
    if not isinstance(data, dict):
        return []
    rows = data.get("diff")
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict)]


def probe_dns(logger: logging.Logger) -> dict[str, Any]:
    hosts = (
        "www.eastmoney.com",
        "quote.eastmoney.com",
        "push2.eastmoney.com",
        "push2his.eastmoney.com",
    )
    results: dict[str, Any] = {}
    logger.info("阶段 1/7：DNS 与网络环境")

    for host in hosts:
        started = time.perf_counter()
        try:
            records = socket.getaddrinfo(
                host,
                443,
                type=socket.SOCK_STREAM,
            )
            addresses = sorted(
                {record[4][0] for record in records}
            )
            results[host] = {
                "ok": True,
                "addresses": addresses,
                "elapsed_ms": round(
                    (time.perf_counter() - started) * 1000,
                    2,
                ),
                "reserved_test_network": any(
                    address.startswith("198.18.")
                    or address.startswith("198.19.")
                    for address in addresses
                ),
            }
            logger.info(
                "DNS %-25s %s%s",
                host,
                ", ".join(addresses),
                (
                    " [代理/TUN 保留地址]"
                    if results[host]["reserved_test_network"]
                    else ""
                ),
            )
        except Exception as error:
            results[host] = {
                "ok": False,
                "addresses": [],
                "elapsed_ms": round(
                    (time.perf_counter() - started) * 1000,
                    2,
                ),
                "error": f"{type(error).__name__}: {error}",
            }
            logger.error("DNS %-25s 失败：%s", host, error)
    return results


def select_list_endpoint(
    transport: ProbeTransport,
    logger: logging.Logger,
) -> tuple[str | None, dict[str, Any]]:
    logger.info("阶段 2/7：列表端点兼容性")
    attempts: dict[str, Any] = {}
    selected: str | None = None

    for name, endpoint in LIST_ENDPOINTS:
        result = transport.get_json(
            build_list_url(endpoint, "CN", 5),
            MARKETS["CN"]["referer"],
        )
        rows = extract_rows(result)
        attempts[name] = {
            **result.public_summary(),
            "valid_rows": len(rows),
        }
        if result.ok and rows:
            selected = selected or endpoint
            logger.info(
                "列表端点 %-10s 可用：HTTP %s，%d 行，%.0f ms",
                name,
                result.status,
                len(rows),
                result.elapsed_ms,
            )
        else:
            logger.warning(
                "列表端点 %-10s 不可用：HTTP %s，%s",
                name,
                result.status,
                result.error,
            )

    if selected is None:
        logger.error("两个股票列表端点都不可用")
    return selected, attempts


def probe_market_lists(
    transport: ProbeTransport,
    endpoint: str | None,
    page_size: int,
    target_per_market: int,
    logger: logging.Logger,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    logger.info("阶段 3/7：四市场股票列表")
    results: dict[str, Any] = {}
    samples: dict[str, dict[str, Any]] = {}

    if endpoint is None:
        for market in MARKETS:
            results[market] = {
                "ok": False,
                "error": "NO_LIST_ENDPOINT",
            }
        return results, samples

    pages_per_market = math.ceil(target_per_market / page_size)

    for market, config in MARKETS.items():
        unique_instruments: dict[str, dict[str, Any]] = {}
        page_calls: list[dict[str, Any]] = []
        reported_total: int | None = None

        for page in range(1, pages_per_market + 1):
            result = transport.get_json(
                build_list_url(endpoint, market, page_size, page),
                config["referer"],
            )
            rows = extract_rows(result)
            page_calls.append(
                {
                    "page": page,
                    **result.public_summary(),
                    "rows": len(rows),
                }
            )
            payload_data = (
                result.payload.get("data")
                if result.ok and isinstance(result.payload, dict)
                else None
            )
            if isinstance(payload_data, dict):
                total_value = payload_data.get("total")
                if isinstance(total_value, int):
                    reported_total = total_value

            for row in rows:
                instrument = sample_instrument(row)
                secid = instrument.get("secid")
                if secid and instrument.get("name"):
                    unique_instruments[str(secid)] = instrument

            if not result.ok:
                break
            available_target = min(
                target_per_market,
                reported_total
                if isinstance(reported_total, int)
                and reported_total > 0
                else target_per_market,
            )
            if len(unique_instruments) >= available_target:
                break

        valid_samples = list(unique_instruments.values())
        available_target = min(
            target_per_market,
            reported_total
            if isinstance(reported_total, int) and reported_total > 0
            else target_per_market,
        )
        successful_calls = sum(
            1
            for call in page_calls
            if call["ok"] and call["rows"] > 0
        )
        coverage_ok = (
            available_target > 0
            and len(valid_samples) >= available_target
        )
        results[market] = {
            "ok": coverage_ok,
            "market_name": config["name"],
            "requested_page_size": page_size,
            "target_per_market": target_per_market,
            "available_target": available_target,
            "row_count": len(valid_samples),
            "reported_total": reported_total,
            "pages_planned": pages_per_market,
            "pages_requested": len(page_calls),
            "successful_page_calls": successful_calls,
            "status_counts": dict(
                Counter(
                    str(call["status"])
                    if call["status"] is not None
                    else "NO_HTTP"
                    for call in page_calls
                )
            ),
            "latency": latency_summary(
                call["elapsed_ms"] for call in page_calls
            ),
            "response_bytes_total": sum(
                call["response_bytes"] for call in page_calls
            ),
            "page_calls": page_calls,
            "samples": valid_samples[:3],
        }

        if valid_samples:
            samples[market] = valid_samples[0]

        if coverage_ok:
            logger.info(
                "%s列表可用：%d/%d 只，total=%s，%d 页，"
                "p95=%s ms，%d bytes",
                config["name"],
                len(valid_samples),
                available_target,
                reported_total,
                len(page_calls),
                results[market]["latency"]["p95_ms"],
                results[market]["response_bytes_total"],
            )
            for sample in valid_samples[:2]:
                logger.info(
                    "  样本 %s %s，secid=%s，价格=%s",
                    sample["symbol"],
                    sample["name"],
                    sample["secid"],
                    sample["price"],
                )
        else:
            logger.error(
                "%s列表覆盖不足：%d/%d 只，成功页 %d/%d，"
                "错误=%s",
                config["name"],
                len(valid_samples),
                available_target,
                successful_calls,
                len(page_calls),
                page_calls[-1].get("error") if page_calls else "无请求",
            )

    return results, samples


def probe_instrument_data(
    transport: ProbeTransport,
    samples: dict[str, dict[str, Any]],
    logger: logging.Logger,
) -> dict[str, Any]:
    logger.info("阶段 4/7：单股报价、日 K 与分时")
    results: dict[str, Any] = {}

    for market, sample in samples.items():
        secid = str(sample["secid"])
        referer = MARKETS[market]["referer"]
        quote = transport.get_json(
            build_quote_url(secid),
            referer,
        )
        kline = transport.get_json(
            build_kline_url(secid),
            referer,
        )
        trends = transport.get_json(
            build_trends_url(secid),
            referer,
        )
        quote_data = (
            quote.payload.get("data")
            if quote.ok and isinstance(quote.payload, dict)
            else None
        )
        kline_data = (
            kline.payload.get("data")
            if kline.ok and isinstance(kline.payload, dict)
            else None
        )
        trends_data = (
            trends.payload.get("data")
            if trends.ok and isinstance(trends.payload, dict)
            else None
        )
        klines = (
            kline_data.get("klines")
            if isinstance(kline_data, dict)
            else None
        )
        trend_rows = (
            trends_data.get("trends")
            if isinstance(trends_data, dict)
            else None
        )

        results[market] = {
            "instrument": sample,
            "quote": {
                **quote.public_summary(),
                "valid": (
                    isinstance(quote_data, dict)
                    and bool(quote_data.get("f57"))
                    and isinstance(quote_data.get("f43"), (int, float))
                ),
                "snapshot": (
                    {
                        "symbol": quote_data.get("f57"),
                        "name": quote_data.get("f58"),
                        "price": quote_data.get("f43"),
                        "previous_close": quote_data.get("f60"),
                        "volume": quote_data.get("f47"),
                        "change_percent": quote_data.get("f170"),
                        "quote_epoch_f86": quote_data.get("f86"),
                        "quote_epoch_f124": quote_data.get("f124"),
                    }
                    if isinstance(quote_data, dict)
                    else None
                ),
            },
            "daily_kline": {
                **kline.public_summary(),
                "valid": isinstance(klines, list) and len(klines) > 0,
                "rows": len(klines) if isinstance(klines, list) else 0,
                "first": (
                    klines[0]
                    if isinstance(klines, list) and klines
                    else None
                ),
                "last": (
                    klines[-1]
                    if isinstance(klines, list) and klines
                    else None
                ),
            },
            "intraday": {
                **trends.public_summary(),
                "valid": (
                    isinstance(trend_rows, list)
                    and len(trend_rows) > 0
                ),
                "rows": (
                    len(trend_rows)
                    if isinstance(trend_rows, list)
                    else 0
                ),
                "first": (
                    trend_rows[0]
                    if isinstance(trend_rows, list) and trend_rows
                    else None
                ),
                "last": (
                    trend_rows[-1]
                    if isinstance(trend_rows, list) and trend_rows
                    else None
                ),
            },
        }

        logger.info(
            "%s %s：报价=%s(%.0fms)，日K=%s/%d，分时=%s/%d",
            MARKETS[market]["name"],
            sample["symbol"],
            "成功" if results[market]["quote"]["valid"] else "失败",
            quote.elapsed_ms,
            "成功" if results[market]["daily_kline"]["valid"] else "失败",
            results[market]["daily_kline"]["rows"],
            "成功" if results[market]["intraday"]["valid"] else "失败",
            results[market]["intraday"]["rows"],
        )

    for market in MARKETS:
        if market not in results:
            results[market] = {
                "instrument": None,
                "quote": {"valid": False, "error": "NO_SAMPLE"},
                "daily_kline": {
                    "valid": False,
                    "error": "NO_SAMPLE",
                },
                "intraday": {
                    "valid": False,
                    "error": "NO_SAMPLE",
                },
            }
    return results


def quote_state(result: HttpResult) -> tuple[Any, ...] | None:
    if not result.ok or not isinstance(result.payload, dict):
        return None
    data = result.payload.get("data")
    if not isinstance(data, dict):
        return None
    return (
        data.get("f43"),
        data.get("f47"),
        data.get("f86"),
        data.get("f124"),
    )


def observe_quote_changes(
    transport: ProbeTransport,
    samples: dict[str, dict[str, Any]],
    seconds: float,
    interval: float,
    logger: logging.Logger,
) -> dict[str, Any]:
    logger.info("阶段 5/7：四市场样本行情变化观察")
    if seconds <= 0 or not samples:
        logger.info("已跳过行情变化观察")
        return {"skipped": True}

    observations: dict[str, dict[str, Any]] = {
        market: {
            "requests": 0,
            "successes": 0,
            "states": [],
            "errors": [],
            "latencies_ms": [],
        }
        for market in samples
    }
    cycles = max(1, math.ceil(seconds / interval))
    started = time.perf_counter()

    with concurrent.futures.ThreadPoolExecutor(
        max_workers=len(samples),
        thread_name_prefix="observe",
    ) as executor:
        for cycle in range(cycles):
            target = started + cycle * interval
            remaining = target - time.perf_counter()
            if remaining > 0:
                time.sleep(remaining)

            futures = {
                market: executor.submit(
                    transport.get_json,
                    build_quote_url(str(sample["secid"])),
                    MARKETS[market]["referer"],
                )
                for market, sample in samples.items()
            }

            for market, future in futures.items():
                result = future.result()
                record = observations[market]
                record["requests"] += 1
                record["latencies_ms"].append(result.elapsed_ms)
                state = quote_state(result)

                if state is not None:
                    record["successes"] += 1
                    record["states"].append(state)
                elif len(record["errors"]) < 5:
                    record["errors"].append(
                        {
                            "status": result.status,
                            "type": result.error_type,
                            "error": result.error,
                        }
                    )

    summary: dict[str, Any] = {}
    for market, record in observations.items():
        unique_states = {
            json.dumps(state, ensure_ascii=False)
            for state in record.pop("states")
        }
        latencies = record.pop("latencies_ms")
        summary[market] = {
            **record,
            "unique_quote_states": len(unique_states),
            "changed_during_observation": len(unique_states) > 1,
            "latency": latency_summary(latencies),
        }
        logger.info(
            "%s：成功 %d/%d，唯一状态 %d，变化=%s，p95=%s ms",
            MARKETS[market]["name"],
            record["successes"],
            record["requests"],
            len(unique_states),
            "是" if len(unique_states) > 1 else "否/可能已休市",
            summary[market]["latency"]["p95_ms"],
        )
    summary["elapsed_seconds"] = round(
        time.perf_counter() - started,
        2,
    )
    return summary


def load_request(
    transport: ProbeTransport,
    url: str,
    referer: str,
) -> HttpResult:
    return transport.get_json(
        url,
        referer,
        cache_bust=True,
    )


def run_load_stage(
    transport: ProbeTransport,
    url: str,
    referer: str,
    qps: int,
    duration: float,
) -> dict[str, Any]:
    requested = max(1, int(round(qps * duration)))
    worker_count = min(max(2, qps), 64)
    started = time.perf_counter()

    with concurrent.futures.ThreadPoolExecutor(
        max_workers=worker_count,
        thread_name_prefix=f"qps-{qps}",
    ) as executor:
        futures: list[concurrent.futures.Future[HttpResult]] = []
        for index in range(requested):
            target = started + index / qps
            remaining = target - time.perf_counter()
            if remaining > 0:
                time.sleep(remaining)
            future = executor.submit(
                load_request,
                transport,
                url,
                referer,
            )
            futures.append(future)

        concurrent.futures.wait(futures)
        results = [future.result() for future in futures]

    elapsed = time.perf_counter() - started
    status_counts = Counter(
        str(result.status) if result.status is not None else "NO_HTTP"
        for result in results
    )
    error_counts = Counter(
        result.error_type or "NONE"
        for result in results
        if not result.ok
    )
    successes = sum(1 for result in results if result.ok)
    rate_limited = sum(
        1
        for result in results
        if result.status in {403, 418, 429}
    )
    sample_errors = [
        {
            "status": result.status,
            "type": result.error_type,
            "error": result.error,
        }
        for result in results
        if not result.ok
    ][:8]
    return {
        "target_qps": qps,
        "duration_seconds": duration,
        "requested": requested,
        "completed": len(results),
        "successes": successes,
        "success_rate": round(
            successes / len(results),
            6,
        )
        if results
        else 0,
        "rate_limited": rate_limited,
        "actual_elapsed_seconds": round(elapsed, 3),
        "actual_throughput_rps": round(
            len(results) / elapsed,
            3,
        )
        if elapsed
        else 0,
        "status_counts": dict(status_counts),
        "error_counts": dict(error_counts),
        "response_bytes_total": sum(
            result.response_bytes for result in results
        ),
        "latency": latency_summary(
            result.elapsed_ms for result in results
        ),
        "sample_errors": sample_errors,
    }


def probe_high_frequency(
    transport: ProbeTransport,
    samples: dict[str, dict[str, Any]],
    qps_values: list[int],
    duration: float,
    skip: bool,
    logger: logging.Logger,
) -> dict[str, Any]:
    logger.info("阶段 6/7：有限强度高频与限流探测")
    if skip or not samples:
        logger.info("已跳过高频阶段")
        return {"skipped": True, "stages": []}

    market = "CN" if "CN" in samples else next(iter(samples))
    sample = samples[market]
    url = build_quote_url(str(sample["secid"]))
    stages: list[dict[str, Any]] = []

    for qps in qps_values:
        logger.info(
            "开始 %d QPS，持续 %.1f 秒（约 %d 次请求）",
            qps,
            duration,
            max(1, int(round(qps * duration))),
        )
        stage = run_load_stage(
            transport,
            url,
            MARKETS[market]["referer"],
            qps,
            duration,
        )
        stages.append(stage)
        logger.info(
            "%d QPS：成功率 %.2f%%，实测 %.2f req/s，"
            "p50=%s ms，p95=%s ms，p99=%s ms，限流=%d",
            qps,
            stage["success_rate"] * 100,
            stage["actual_throughput_rps"],
            stage["latency"]["p50_ms"],
            stage["latency"]["p95_ms"],
            stage["latency"]["p99_ms"],
            stage["rate_limited"],
        )
        if stage["sample_errors"]:
            logger.warning(
                "%d QPS 错误样本：%s",
                qps,
                json.dumps(
                    stage["sample_errors"][:2],
                    ensure_ascii=False,
                ),
            )

    return {
        "skipped": False,
        "instrument": sample,
        "stages": stages,
    }


def probe_batch_polling(
    transport: ProbeTransport,
    endpoint: str | None,
    page_size: int,
    target_per_market: int,
    cycles: int,
    interval: float,
    logger: logging.Logger,
) -> dict[str, Any]:
    logger.info("阶段 7/7：四市场批量轮询")
    if endpoint is None or cycles <= 0:
        logger.info("已跳过批量轮询")
        return {"skipped": True}

    calls: list[dict[str, Any]] = []
    cycle_summaries: list[dict[str, Any]] = []
    started = time.perf_counter()
    pages_per_market = math.ceil(target_per_market / page_size)
    tasks_per_cycle = len(MARKETS) * pages_per_market

    with concurrent.futures.ThreadPoolExecutor(
        max_workers=min(tasks_per_cycle, 24),
        thread_name_prefix="batch",
    ) as executor:
        for cycle in range(cycles):
            target = started + cycle * interval
            remaining = target - time.perf_counter()
            if remaining > 0:
                time.sleep(remaining)
            cycle_started = time.perf_counter()
            futures = {
                (market, page): executor.submit(
                    transport.get_json,
                    build_list_url(
                        endpoint,
                        market,
                        page_size,
                        page,
                    ),
                    config["referer"],
                )
                for market, config in MARKETS.items()
                for page in range(1, pages_per_market + 1)
            }
            instruments_by_market: dict[str, set[str]] = {
                market: set() for market in MARKETS
            }
            successful_pages_by_market: Counter[str] = Counter()

            for (market, page), future in futures.items():
                result = future.result()
                rows = extract_rows(result)
                for row in rows:
                    instrument = sample_instrument(row)
                    if instrument.get("secid"):
                        instruments_by_market[market].add(
                            str(instrument["secid"])
                        )
                if result.ok and rows:
                    successful_pages_by_market[market] += 1
                record = {
                    "cycle": cycle + 1,
                    "market": market,
                    "page": page,
                    **result.public_summary(),
                    "rows": len(rows),
                }
                calls.append(record)

            cycle_rows = sum(
                len(instruments)
                for instruments in instruments_by_market.values()
            )
            covered_markets = sum(
                1
                for market in MARKETS
                if len(instruments_by_market[market])
                >= target_per_market
                and successful_pages_by_market[market]
                == pages_per_market
            )

            cycle_elapsed = (
                time.perf_counter() - cycle_started
            ) * 1000
            cycle_summary = {
                "cycle": cycle + 1,
                "covered_markets": covered_markets,
                "rows": cycle_rows,
                "elapsed_ms": round(cycle_elapsed, 2),
                "market_rows": {
                    market: len(instruments)
                    for market, instruments in instruments_by_market.items()
                },
            }
            cycle_summaries.append(cycle_summary)
            logger.info(
                "批量轮询 %d/%d：市场成功 %d/4，共 %d 行，%.0f ms",
                cycle + 1,
                cycles,
                covered_markets,
                cycle_rows,
                cycle_elapsed,
            )

    successful_calls = [
        call for call in calls if call["ok"] and call["rows"] > 0
    ]
    status_counts = Counter(
        str(call["status"])
        if call["status"] is not None
        else "NO_HTTP"
        for call in calls
    )
    return {
        "skipped": False,
        "cycles": cycles,
        "interval_seconds": interval,
        "page_size": page_size,
        "target_per_market": target_per_market,
        "pages_per_market": pages_per_market,
        "calls_per_cycle": tasks_per_cycle,
        "calls": len(calls),
        "successful_calls": len(successful_calls),
        "success_rate": round(
            len(successful_calls) / len(calls),
            6,
        )
        if calls
        else 0,
        "coverage_success_rate": round(
            sum(
                summary["covered_markets"]
                for summary in cycle_summaries
            )
            / (len(cycle_summaries) * len(MARKETS)),
            6,
        )
        if cycle_summaries
        else 0,
        "status_counts": dict(status_counts),
        "latency": latency_summary(
            call["elapsed_ms"] for call in calls
        ),
        "response_bytes_total": sum(
            call["response_bytes"] for call in calls
        ),
        "cycle_summaries": cycle_summaries,
        "failed_calls": [
            call for call in calls if not call["ok"] or call["rows"] == 0
        ][:12],
    }


def assess_result(report: dict[str, Any]) -> dict[str, Any]:
    market_lists = report.get("market_lists", {})
    instrument_data = report.get("instrument_data", {})
    list_markets_ok = [
        market
        for market in MARKETS
        if market_lists.get(market, {}).get("ok")
        and market_lists.get(market, {}).get("row_count", 0) > 0
    ]
    quote_markets_ok = [
        market
        for market in MARKETS
        if instrument_data.get(market, {})
        .get("quote", {})
        .get("valid")
    ]
    kline_markets_ok = [
        market
        for market in MARKETS
        if instrument_data.get(market, {})
        .get("daily_kline", {})
        .get("valid")
    ]
    intraday_markets_ok = [
        market
        for market in MARKETS
        if instrument_data.get(market, {})
        .get("intraday", {})
        .get("valid")
    ]
    load_stages = report.get("high_frequency", {}).get(
        "stages",
        [],
    )
    load_ok = (
        not load_stages
        or all(
            stage.get("success_rate", 0) >= 0.98
            and stage.get("rate_limited", 0) == 0
            for stage in load_stages
        )
    )
    batch = report.get("batch_polling", {})
    batch_ok = batch.get("skipped") or batch.get(
        "coverage_success_rate",
        0,
    ) >= 0.98
    all_markets_core = (
        len(list_markets_ok) == len(MARKETS)
        and len(quote_markets_ok) == len(MARKETS)
    )
    historical_core = (
        len(kline_markets_ok) >= 3
        and len(intraday_markets_ok) >= 3
    )

    if all_markets_core and historical_core and load_ok and batch_ok:
        verdict = "PASS"
        recommendation = (
            "接口在本环境具备直接接入条件。仍应保留数据提供者抽象、"
            "独立数据库、超时重试、批量轮询、缓存和断线降级；"
            "不要让页面逐股直连东方财富。"
        )
    elif list_markets_ok or quote_markets_ok:
        verdict = "PARTIAL"
        recommendation = (
            "接口部分可用，不宜直接锁死为唯一数据源。先根据失败市场、"
            "K 线或限流日志修正适配器，并继续保留可替换提供者接口。"
        )
    else:
        verdict = "FAIL"
        recommendation = (
            "当前 Python 运行环境无法可靠取得行情。项目只保留提供者接口"
            "与接入文档，不应自动联网或用虚构数据补位。"
        )

    return {
        "verdict": verdict,
        "list_markets_ok": list_markets_ok,
        "quote_markets_ok": quote_markets_ok,
        "kline_markets_ok": kline_markets_ok,
        "intraday_markets_ok": intraday_markets_ok,
        "load_ok": load_ok,
        "batch_ok": bool(batch_ok),
        "recommendation": recommendation,
        "important_note": (
            "本探测只证明技术可达性和短时稳定性，不代表东方财富公开"
            "网页接口提供长期 SLA，也不替代数据授权与使用条款确认。"
        ),
    }


def argument_summary(arguments: argparse.Namespace) -> dict[str, Any]:
    return {
        "timeout": arguments.timeout,
        "qps": arguments.qps_values,
        "duration": arguments.duration,
        "observe_seconds": arguments.observe_seconds,
        "observe_interval": arguments.observe_interval,
        "batch_cycles": arguments.batch_cycles,
        "batch_interval": arguments.batch_interval,
        "page_size": arguments.page_size,
        "target_per_market": arguments.target_per_market,
        "proxy": redacted_proxy(arguments.proxy),
        "no_system_proxy": arguments.no_system_proxy,
        "skip_load": arguments.skip_load,
        "quick": arguments.quick,
    }


def main() -> int:
    arguments = parse_arguments()
    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    logger, log_path = configure_logging(
        arguments.output_dir.resolve(),
        run_id,
        arguments.debug,
    )
    json_path = (
        arguments.output_dir.resolve()
        / f"eastmoney_probe_{run_id}.json"
    )
    started = time.perf_counter()
    report: dict[str, Any] = {
        "schema_version": 1,
        "script_version": SCRIPT_VERSION,
        "run_id": run_id,
        "started_at": utc_now(),
        "environment": {
            "python": sys.version,
            "python_executable_name": Path(sys.executable).name,
            "platform": platform.platform(),
            "machine": platform.machine(),
            "privacy_notice": (
                "报告不记录计算机名、公网 IP、用户名或代理认证信息"
            ),
            "system_proxies": system_proxy_summary(),
            "explicit_proxy": redacted_proxy(arguments.proxy),
        },
        "arguments": argument_summary(arguments),
    }

    logger.info("=" * 72)
    logger.info(
        "东方财富行情接口探测 v%s，run_id=%s",
        SCRIPT_VERSION,
        run_id,
    )
    logger.info("Python：%s", sys.version.replace(os.linesep, " "))
    logger.info("平台：%s", platform.platform())
    logger.info(
        "代理：显式=%s，系统=%s，强制直连=%s",
        redacted_proxy(arguments.proxy),
        json.dumps(system_proxy_summary(), ensure_ascii=False),
        arguments.no_system_proxy,
    )
    logger.info(
        "参数：每市场 %d 只（每页 %d），QPS=%s，"
        "每档 %.1fs，观察 %.1fs，批量 %d 轮",
        arguments.target_per_market,
        arguments.page_size,
        arguments.qps_values,
        arguments.duration,
        arguments.observe_seconds,
        arguments.batch_cycles,
    )
    logger.info(
        "说明：只发公开 GET 请求；不会登录、下单或写项目数据库。"
    )
    logger.info("=" * 72)

    try:
        transport = ProbeTransport(
            timeout=arguments.timeout,
            proxy=arguments.proxy,
            no_system_proxy=arguments.no_system_proxy,
        )
        report["dns"] = probe_dns(logger)
        selected_endpoint, endpoint_attempts = select_list_endpoint(
            transport,
            logger,
        )
        report["list_endpoint"] = {
            "selected": selected_endpoint,
            "attempts": endpoint_attempts,
        }
        market_lists, samples = probe_market_lists(
            transport,
            selected_endpoint,
            arguments.page_size,
            arguments.target_per_market,
            logger,
        )
        report["market_lists"] = market_lists
        report["instrument_data"] = probe_instrument_data(
            transport,
            samples,
            logger,
        )
        report["quote_observation"] = observe_quote_changes(
            transport,
            samples,
            arguments.observe_seconds,
            arguments.observe_interval,
            logger,
        )
        report["high_frequency"] = probe_high_frequency(
            transport,
            samples,
            arguments.qps_values,
            arguments.duration,
            arguments.skip_load,
            logger,
        )
        report["batch_polling"] = probe_batch_polling(
            transport,
            selected_endpoint,
            arguments.page_size,
            arguments.target_per_market,
            arguments.batch_cycles,
            arguments.batch_interval,
            logger,
        )
        report["assessment"] = assess_result(report)
        exit_code = 0
    except KeyboardInterrupt:
        logger.warning("用户中断了探测，已保存现有结果")
        report["fatal_error"] = {
            "type": "KeyboardInterrupt",
            "message": "用户中断",
        }
        report["assessment"] = {
            "verdict": "INTERRUPTED",
            "recommendation": "请重新运行完整探测。",
        }
        exit_code = 130
    except Exception as error:
        logger.exception("探测发生未处理异常：%s", error)
        report["fatal_error"] = {
            "type": type(error).__name__,
            "message": str(error),
            "traceback": traceback.format_exc(),
        }
        report["assessment"] = {
            "verdict": "FAIL",
            "recommendation": (
                "脚本发生异常，请把 log 和 json 一起交给开发者。"
            ),
        }
        exit_code = 1

    report["finished_at"] = utc_now()
    report["elapsed_seconds"] = round(
        time.perf_counter() - started,
        3,
    )

    try:
        json_path.write_text(
            json.dumps(
                report,
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            ),
            encoding="utf-8",
        )
    except Exception as error:
        logger.error("JSON 报告写入失败：%s", error)
        exit_code = exit_code or 1

    assessment = report.get("assessment", {})
    logger.info("=" * 72)
    logger.info(
        "探测结论：%s",
        assessment.get("verdict", "UNKNOWN"),
    )
    logger.info(
        "建议：%s",
        assessment.get("recommendation", "请查看 JSON 详情"),
    )
    logger.info("耗时：%.2f 秒", report["elapsed_seconds"])
    logger.info("文本日志：%s", log_path)
    logger.info("JSON 报告：%s", json_path)
    logger.info(
        "请把这两个文件发回给我：%s 以及 %s",
        log_path.name,
        json_path.name,
    )
    logger.info("=" * 72)

    if arguments.pause:
        try:
            input("按回车键退出……")
        except EOFError:
            pass
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
