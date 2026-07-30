import type {
  ChartSeries,
  DisplayCurrency,
  QuoteCurrency,
} from "@gupiaomoniqi/shared";
import {
  type MouseEvent,
  useId,
  useMemo,
  useState,
} from "react";
import {
  formatNumber,
  formatPercent,
  formatQuoteMoney,
  quoteToDisplay,
  signedClass,
} from "../format";

interface MarketChartProps {
  series: ChartSeries;
  quoteCurrency: QuoteCurrency;
  displayCurrency: DisplayCurrency;
}

const WIDTH = 920;
const HEIGHT = 470;
const LEFT = 58;
const RIGHT = 18;
const PRICE_TOP = 18;
const PRICE_BOTTOM = 286;
const VOLUME_TOP = 306;
const VOLUME_BOTTOM = 356;
const MACD_TOP = 386;
const MACD_BOTTOM = 448;

export function MarketChart({
  series,
  quoteCurrency,
  displayCurrency,
}: MarketChartProps) {
  const gradientId = useId().replaceAll(":", "");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const chart = useMemo(
    () =>
      buildChartModel(series, quoteCurrency, displayCurrency),
    [displayCurrency, quoteCurrency, series],
  );
  const active =
    hoverIndex === null
      ? series.candles[series.candles.length - 1]
      : series.candles[hoverIndex];
  const activePoint =
    hoverIndex === null
      ? chart.candles[chart.candles.length - 1]
      : chart.candles[hoverIndex];

  if (series.candles.length === 0 || !active) {
    return (
      <div className="chart-empty">
        数据库尚未积累该周期行情；系统不会生成假历史。
      </div>
    );
  }

  const referencePrice = series.referencePrice;
  const activeChangeAmount =
    referencePrice === undefined ? null : active.close - referencePrice;
  const activeChangePercent =
    referencePrice === undefined ||
    referencePrice <= 0 ||
    activeChangeAmount === null
      ? null
      : (activeChangeAmount / referencePrice) * 100;
  const activeAverageChangePercent =
    series.range === "INTRADAY" &&
    active.averagePrice !== undefined &&
    referencePrice !== undefined &&
    referencePrice > 0
      ? ((active.averagePrice - referencePrice) / referencePrice) * 100
      : null;
  const statusTone = signedClass(activeChangeAmount ?? 0);

  const activeX =
    hoverIndex === null
      ? null
      : xFor(hoverIndex, series.candles.length);

  function handleMouseMove(event: MouseEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const relativeX =
      ((event.clientX - bounds.left) / bounds.width) * WIDTH;
    const ratio = Math.min(
      1,
      Math.max(0, (relativeX - LEFT) / (WIDTH - LEFT - RIGHT)),
    );
    setHoverIndex(
      Math.round(ratio * (series.candles.length - 1)),
    );
  }

  return (
    <div className="market-chart">
      {series.range === "INTRADAY" ? (
        <div className={`chart-status-strip ${statusTone}`}>
          <div className="chart-status-price">
            <strong>
              {formatQuoteMoney(active.close, quoteCurrency, displayCurrency)}
            </strong>
            <span>最新</span>
          </div>
          {activeChangeAmount !== null ? (
            <div className="chart-status-metric">
              <strong>
                {formatSignedQuoteMoney(
                  activeChangeAmount,
                  quoteCurrency,
                  displayCurrency,
                )}
              </strong>
              <span>涨跌额</span>
            </div>
          ) : null}
          {activeChangePercent !== null ? (
            <div className="chart-status-metric">
              <strong>{formatPercent(activeChangePercent)}</strong>
              <span>涨跌幅</span>
            </div>
          ) : null}
          {active.averagePrice !== undefined ? (
            <div className="chart-status-metric">
              <strong>
                {formatQuoteMoney(
                  active.averagePrice,
                  quoteCurrency,
                  displayCurrency,
                )}
              </strong>
              <span>均价</span>
            </div>
          ) : null}
          {activeAverageChangePercent !== null ? (
            <div className="chart-status-metric">
              <strong>{formatPercent(activeAverageChangePercent)}</strong>
              <span>均价幅</span>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="chart-readout">
        <span>数据库记录</span>
        {series.coverageStart ? (
          <span>
            起点 {formatChartTime(series.coverageStart, series.range)}
          </span>
        ) : null}
        <span>{formatChartTime(active.time, series.range)}</span>
        <span>
          开 {formatQuoteMoney(active.open, quoteCurrency, displayCurrency)}
        </span>
        <span>
          高 {formatQuoteMoney(active.high, quoteCurrency, displayCurrency)}
        </span>
        <span>
          低 {formatQuoteMoney(active.low, quoteCurrency, displayCurrency)}
        </span>
        <span>
          收 {formatQuoteMoney(active.close, quoteCurrency, displayCurrency)}
        </span>
        {series.range === "INTRADAY" && active.averagePrice ? (
          <span>
            均 {formatQuoteMoney(active.averagePrice, quoteCurrency, displayCurrency)}
          </span>
        ) : null}
        <span>量 {formatNumber(active.volume, { compact: true })}</span>
        {active.isPartial ? <span>本周期进行中</span> : null}
      </div>

      {series.range === "INTRADAY" ? (
        <div className="chart-intraday-readout">
          <span className="label">时间</span>
          <strong>{formatChartTime(active.time, series.range)}</strong>
          <span className="label">价格</span>
          <strong className={statusTone}>
            {formatQuoteMoney(active.close, quoteCurrency, displayCurrency)}
          </strong>
          <span className="label">均价</span>
          <strong className={signedClass((active.averagePrice ?? active.close) - (referencePrice ?? active.close))}>
            {active.averagePrice !== undefined
              ? formatQuoteMoney(
                  active.averagePrice,
                  quoteCurrency,
                  displayCurrency,
                )
              : "--"}
          </strong>
          <span className="label">成交量</span>
          <strong>{formatNumber(active.volume, { compact: true })}</strong>
          <span className="label">昨收</span>
          <strong>
            {referencePrice === undefined
              ? "--"
              : formatQuoteMoney(
                  referencePrice,
                  quoteCurrency,
                  displayCurrency,
                )}
          </strong>
        </div>
      ) : null}

      <div className="chart-stage">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`${series.range} 数据库行情图`}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient
              id={gradientId}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor="#cf3f36" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#cf3f36" stopOpacity="0" />
            </linearGradient>
          </defs>

          {chart.priceGrid.map((grid) => (
            <g key={grid.y}>
              <line
                className="chart-grid-line"
                x1={LEFT}
                x2={WIDTH - RIGHT}
                y1={grid.y}
                y2={grid.y}
              />
              <text
                className={`chart-axis-label ${grid.tone}`}
                x={LEFT - 8}
                y={grid.y + 4}
              >
                {grid.label}
              </text>
              {grid.changeLabel ? (
                <text
                  className={`chart-axis-label chart-axis-label-right ${grid.tone}`}
                  x={WIDTH - RIGHT + 8}
                  y={grid.y + 4}
                >
                  {grid.changeLabel}
                </text>
              ) : null}
            </g>
          ))}

          {chart.timeGrid.map((grid) => (
            <line
              className="chart-grid-line chart-grid-line-vertical"
              key={grid.x}
              x1={grid.x}
              x2={grid.x}
              y1={PRICE_TOP}
              y2={PRICE_BOTTOM}
            />
          ))}

          {series.range === "INTRADAY"
            ? chart.timeGrid.map((grid) => (
                <line
                  className="chart-grid-line chart-grid-line-vertical chart-grid-line-volume"
                  key={`${grid.x}-volume`}
                  x1={grid.x}
                  x2={grid.x}
                  y1={VOLUME_TOP}
                  y2={VOLUME_BOTTOM}
                />
              ))
            : null}

          {chart.referenceY !== null ? (
            <line
              className="chart-reference-line"
              x1={LEFT}
              x2={WIDTH - RIGHT}
              y1={chart.referenceY}
              y2={chart.referenceY}
            />
          ) : null}

          {series.range === "INTRADAY" ? (
            <>
              <path
                className="timeline-area"
                d={`${chart.linePath} L ${WIDTH - RIGHT} ${PRICE_BOTTOM} L ${LEFT} ${PRICE_BOTTOM} Z`}
                fill={`url(#${gradientId})`}
              />
              <path className="timeline-line" d={chart.linePath} />
              {chart.averagePath ? (
                <path className="timeline-average-line" d={chart.averagePath} />
              ) : null}
            </>
          ) : (
            chart.candles.map((candle) => (
              <g
                className={candle.close >= candle.open ? "candle-up" : "candle-down"}
                key={candle.time}
              >
                <line
                  x1={candle.x}
                  x2={candle.x}
                  y1={candle.highY}
                  y2={candle.lowY}
                />
                <rect
                  x={candle.x - candle.width / 2}
                  y={Math.min(candle.openY, candle.closeY)}
                  width={candle.width}
                  height={Math.max(1.2, Math.abs(candle.openY - candle.closeY))}
                />
              </g>
            ))
          )}

          {chart.volumeBars.map((bar) => (
            <rect
              className={bar.up ? "volume-up" : "volume-down"}
              key={bar.time}
              x={bar.x - bar.width / 2}
              y={bar.y}
              width={bar.width}
              height={VOLUME_BOTTOM - bar.y}
            />
          ))}

          <text className="chart-section-label" x={LEFT} y={VOLUME_TOP - 7}>
            VOL
          </text>

          {series.range !== "INTRADAY" ? (
            <>
              <line
                className="chart-divider"
                x1={LEFT}
                x2={WIDTH - RIGHT}
                y1={MACD_TOP - 13}
                y2={MACD_TOP - 13}
              />
              <text className="chart-section-label" x={LEFT} y={MACD_TOP - 19}>
                MACD (12, 26, 9)
              </text>
              <line
                className="macd-zero"
                x1={LEFT}
                x2={WIDTH - RIGHT}
                y1={chart.macdZeroY}
                y2={chart.macdZeroY}
              />

              {chart.macdBars.map((bar) => (
                <rect
                  className={bar.value >= 0 ? "macd-positive" : "macd-negative"}
                  key={bar.time}
                  x={bar.x - bar.width / 2}
                  y={Math.min(bar.y, chart.macdZeroY)}
                  width={bar.width}
                  height={Math.max(0.8, Math.abs(bar.y - chart.macdZeroY))}
                />
              ))}
              <path className="dif-line" d={chart.difPath} />
              <path className="dea-line" d={chart.deaPath} />
            </>
          ) : null}

          {chart.timeLabels.map((label) => (
            <text
              className="chart-time-label"
              key={label.x}
              x={label.x}
              y={HEIGHT - 4}
              textAnchor={label.anchor}
            >
              {label.text}
            </text>
          ))}

          {activeX !== null ? (
            <line
              className="chart-crosshair"
              x1={activeX}
              x2={activeX}
              y1={PRICE_TOP}
              y2={series.range === "INTRADAY" ? VOLUME_BOTTOM : MACD_BOTTOM}
            />
          ) : null}
        </svg>

        {hoverIndex !== null && activePoint ? (
          <div
            className="chart-hover-card"
            style={{
              left: `${Math.min(78, Math.max(2, (activePoint.x / WIDTH) * 100 + 1.6))}%`,
              top: `${Math.min(72, Math.max(2, (activePoint.closeY / HEIGHT) * 100 - 4))}%`,
            }}
          >
            <strong>{formatChartTime(active.time, series.range)}</strong>
            <span>
              价 {formatQuoteMoney(active.close, quoteCurrency, displayCurrency)}
            </span>
            {series.referencePrice ? (
              <span>
                幅 {formatChangePercent(active.close, series.referencePrice)}
              </span>
            ) : null}
            {series.range === "INTRADAY" && active.averagePrice ? (
              <span>
                均 {formatQuoteMoney(active.averagePrice, quoteCurrency, displayCurrency)}
              </span>
            ) : null}
            <span>量 {formatNumber(active.volume, { compact: true })}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function buildChartModel(
  series: ChartSeries,
  quoteCurrency: QuoteCurrency,
  displayCurrency: DisplayCurrency,
) {
  const displayCandles = series.candles.map((candle) => ({
    ...candle,
    open: quoteToDisplay(candle.open, quoteCurrency, displayCurrency),
    high: quoteToDisplay(candle.high, quoteCurrency, displayCurrency),
    low: quoteToDisplay(candle.low, quoteCurrency, displayCurrency),
    close: quoteToDisplay(candle.close, quoteCurrency, displayCurrency),
    averagePrice:
      candle.averagePrice === undefined
        ? undefined
        : quoteToDisplay(
            candle.averagePrice,
            quoteCurrency,
            displayCurrency,
          ),
  }));
  const averagePrices = displayCandles
    .map((item) => item.averagePrice)
    .filter((value): value is number => value !== undefined);
  const referencePrice =
    series.referencePrice === undefined
      ? undefined
      : quoteToDisplay(series.referencePrice, quoteCurrency, displayCurrency);
  const minimum = Math.min(
    ...displayCandles.map((item) => item.low),
    ...averagePrices,
    referencePrice ?? Number.POSITIVE_INFINITY,
  );
  const maximum = Math.max(
    ...displayCandles.map((item) => item.high),
    ...averagePrices,
    referencePrice ?? Number.NEGATIVE_INFINITY,
  );
  const pricePadding = Math.max((maximum - minimum) * 0.08, maximum * 0.002);
  const intradayOffset =
    series.range === "INTRADAY" && referencePrice !== undefined
      ? Math.max(
          Math.abs(maximum - referencePrice),
          Math.abs(referencePrice - minimum),
          ...averagePrices.map((value) => Math.abs(value - referencePrice)),
        )
      : null;
  const priceMin =
    intradayOffset !== null && referencePrice !== undefined
      ? Math.max(0, referencePrice - intradayOffset * 1.08)
      : Math.max(0, minimum - pricePadding);
  const priceMax =
    intradayOffset !== null && referencePrice !== undefined
      ? referencePrice + intradayOffset * 1.08
      : maximum + pricePadding;
  const priceY = (price: number) =>
    PRICE_BOTTOM -
    ((price - priceMin) / Math.max(Number.EPSILON, priceMax - priceMin)) *
      (PRICE_BOTTOM - PRICE_TOP);
  const candleWidth = Math.max(
    1.4,
    Math.min(
      9,
      ((WIDTH - LEFT - RIGHT) / displayCandles.length) * 0.62,
    ),
  );
  const candles = displayCandles.map((candle, index) => ({
    ...candle,
    x: xFor(index, displayCandles.length),
    openY: priceY(candle.open),
    highY: priceY(candle.high),
    lowY: priceY(candle.low),
    closeY: priceY(candle.close),
    averageY:
      candle.averagePrice === undefined
        ? null
        : priceY(candle.averagePrice),
    width: candleWidth,
  }));
  const linePath = candles
    .map(
      (candle, index) =>
        `${index === 0 ? "M" : "L"} ${candle.x.toFixed(2)} ${candle.closeY.toFixed(2)}`,
    )
    .join(" ");
  const averagePath = candles
    .filter(
      (candle): candle is (typeof candles)[number] & { averageY: number } =>
        candle.averageY !== null,
    )
    .map(
      (candle, index) =>
        `${index === 0 ? "M" : "L"} ${candle.x.toFixed(2)} ${candle.averageY.toFixed(2)}`,
    )
    .join(" ");
  const volumeMax = Math.max(
    1,
    ...displayCandles.map((candle) => candle.volume),
  );
  const volumeBars = candles.map((candle) => ({
    time: candle.time,
    x: candle.x,
    width: candleWidth,
    y:
      VOLUME_BOTTOM -
      (candle.volume / volumeMax) * (VOLUME_BOTTOM - VOLUME_TOP),
    up:
      series.range === "INTRADAY" && referencePrice !== undefined
        ? candle.close >= referencePrice
        : candle.close >= candle.open,
  }));
  const macd = calculateMacd(displayCandles.map((item) => item.close));
  const macdExtent = Math.max(
    Number.EPSILON,
    ...macd.flatMap((item) => [
      Math.abs(item.dif),
      Math.abs(item.dea),
      Math.abs(item.histogram),
    ]),
  );
  const macdZeroY = (MACD_TOP + MACD_BOTTOM) / 2;
  const macdY = (value: number) =>
    macdZeroY -
    (value / macdExtent) * ((MACD_BOTTOM - MACD_TOP) / 2);
  const macdBars = macd.map((item, index) => ({
    ...item,
    time: displayCandles[index]!.time,
    x: xFor(index, displayCandles.length),
    width: candleWidth,
    y: macdY(item.histogram),
    value: item.histogram,
  }));
  const difPath = macd
    .map(
      (item, index) =>
        `${index === 0 ? "M" : "L"} ${xFor(index, macd.length).toFixed(2)} ${macdY(item.dif).toFixed(2)}`,
    )
    .join(" ");
  const deaPath = macd
    .map(
      (item, index) =>
        `${index === 0 ? "M" : "L"} ${xFor(index, macd.length).toFixed(2)} ${macdY(item.dea).toFixed(2)}`,
    )
    .join(" ");
  const priceGridCount = series.range === "INTRADAY" ? 7 : 5;
  const priceGrid = Array.from({ length: priceGridCount }, (_, index) => {
    const ratio = index / Math.max(1, priceGridCount - 1);
    const value = priceMax - ratio * (priceMax - priceMin);
    const changeRatio =
      referencePrice && referencePrice > 0
        ? ((value - referencePrice) / referencePrice) * 100
        : null;
    return {
      y: PRICE_TOP + ratio * (PRICE_BOTTOM - PRICE_TOP),
      label: compactPrice(value),
      changeLabel:
        series.range === "INTRADAY" && changeRatio !== null
          ? `${changeRatio >= 0 ? "+" : ""}${changeRatio.toFixed(2)}%`
          : null,
      tone:
        changeRatio === null
          ? "neutral"
          : Math.abs(changeRatio) < 0.005
            ? "neutral"
            : changeRatio > 0
              ? "up"
              : "down",
    };
  });
  const labelIndexes = [
    0,
    Math.floor((displayCandles.length - 1) / 2),
    displayCandles.length - 1,
  ];
  const timeGrid = Array.from(
    { length: series.range === "INTRADAY" ? 6 : 4 },
    (_, index) => ({
      x:
        LEFT +
        (index /
          Math.max(1, (series.range === "INTRADAY" ? 6 : 4) - 1)) *
          (WIDTH - LEFT - RIGHT),
    }),
  );
  const timeLabels = labelIndexes.map((index, labelIndex) => ({
    x: xFor(index, displayCandles.length),
    text: formatChartTime(displayCandles[index]!.time, series.range),
    anchor:
      labelIndex === 0
        ? ("start" as const)
        : labelIndex === 2
          ? ("end" as const)
          : ("middle" as const),
  }));

  return {
    candles,
    linePath,
    averagePath,
    volumeBars,
    macdBars,
    macdZeroY,
    difPath,
    deaPath,
    priceGrid,
    timeGrid,
    timeLabels,
    referenceY:
      referencePrice === undefined ? null : priceY(referencePrice),
  };
}

function calculateMacd(closes: number[]) {
  const ema12 = exponentialMovingAverage(closes, 12);
  const ema26 = exponentialMovingAverage(closes, 26);
  const dif = closes.map((_, index) => ema12[index]! - ema26[index]!);
  const dea = exponentialMovingAverage(dif, 9);

  return dif.map((value, index) => ({
    dif: value,
    dea: dea[index]!,
    histogram: (value - dea[index]!) * 2,
  }));
}

function exponentialMovingAverage(values: number[], period: number) {
  const multiplier = 2 / (period + 1);
  const result: number[] = [];

  for (let index = 0; index < values.length; index += 1) {
    result.push(
      index === 0
        ? values[index]!
        : values[index]! * multiplier +
            result[index - 1]! * (1 - multiplier),
    );
  }

  return result;
}

function xFor(index: number, length: number): number {
  return (
    LEFT +
    (index / Math.max(1, length - 1)) * (WIDTH - LEFT - RIGHT)
  );
}

function compactPrice(value: number): string {
  if (Math.abs(value) >= 10_000) {
    return formatNumber(value, { compact: true });
  }
  if (Math.abs(value) < 1) {
    return value.toFixed(4);
  }
  return value.toFixed(2);
}

function formatChartTime(time: string, range: ChartSeries["range"]): string {
  const value = new Date(time);

  if (range === "INTRADAY") {
    return value.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  return value.toLocaleDateString("zh-CN", {
    year: range === "DAY" ? undefined : "2-digit",
    month: "2-digit",
    day: range === "DAY" ? "2-digit" : undefined,
  });
}

function formatChangePercent(current: number, reference: number): string {
  if (!Number.isFinite(reference) || reference <= 0) {
    return "--";
  }
  const value = ((current - reference) / reference) * 100;
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatSignedQuoteMoney(
  amount: number,
  quoteCurrency: QuoteCurrency,
  displayCurrency: DisplayCurrency,
): string {
  if (amount === 0) {
    return formatQuoteMoney(0, quoteCurrency, displayCurrency);
  }
  const absolute = formatQuoteMoney(
    Math.abs(amount),
    quoteCurrency,
    displayCurrency,
  );
  return `${amount > 0 ? "+" : "-"}${absolute}`;
}
