import {
  quotePriceToUsd,
  usdToDisplay,
  type DisplayCurrency,
  type QuoteCurrency,
} from "@gupiaomoniqi/shared";

export function quoteToDisplay(
  amount: number,
  quoteCurrency: QuoteCurrency,
  displayCurrency: DisplayCurrency,
): number {
  return usdToDisplay(
    quotePriceToUsd(amount, quoteCurrency),
    displayCurrency,
  );
}

export function formatMoney(
  amountUsd: number,
  displayCurrency: DisplayCurrency,
  options: { compact?: boolean; decimals?: number } = {},
): string {
  const amount = usdToDisplay(amountUsd, displayCurrency);
  const maximumFractionDigits =
    options.decimals ?? (Math.abs(amount) < 1 ? 4 : 2);

  return new Intl.NumberFormat(
    displayCurrency === "CNY" ? "zh-CN" : "en-US",
    {
      style: "currency",
      currency: displayCurrency,
      notation: options.compact ? "compact" : "standard",
      minimumFractionDigits: options.compact ? 0 : Math.min(2, maximumFractionDigits),
      maximumFractionDigits,
    },
  ).format(amount);
}

export function formatQuoteMoney(
  amount: number,
  quoteCurrency: QuoteCurrency,
  displayCurrency: DisplayCurrency,
  options: { compact?: boolean; decimals?: number } = {},
): string {
  return formatMoney(
    quotePriceToUsd(amount, quoteCurrency),
    displayCurrency,
    options,
  );
}

export function formatPercent(value: number): string {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}%`;
}

export function formatNumber(
  value: number,
  options: { compact?: boolean; maximumFractionDigits?: number } = {},
): string {
  return new Intl.NumberFormat("zh-CN", {
    notation: options.compact ? "compact" : "standard",
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
  }).format(value);
}

export function signedClass(value: number): "up" | "down" | "flat" {
  return value > 0 ? "up" : value < 0 ? "down" : "flat";
}
