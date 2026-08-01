import {
  USD_CNY_DISPLAY_RATE,
  type DisplayCurrency,
  type QuoteCurrency,
} from "@gupiaomoniqi/shared";

export function parsePositivePrice(value: string): number | null {
  if (!value.trim()) {
    return null;
  }

  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export function displayPriceToQuote(
  displayPrice: number,
  displayCurrency: DisplayCurrency,
  quoteCurrency: QuoteCurrency,
): number {
  const priceUsd =
    displayCurrency === "CNY"
      ? displayPrice / USD_CNY_DISPLAY_RATE
      : displayPrice;
  const quotePrice =
    quoteCurrency === "CNY"
      ? priceUsd * USD_CNY_DISPLAY_RATE
      : priceUsd;

  return Number(quotePrice.toFixed(4));
}

export function convertDisplayPrice(
  displayPrice: number,
  fromCurrency: DisplayCurrency,
  toCurrency: DisplayCurrency,
): number {
  if (fromCurrency === toCurrency) {
    return displayPrice;
  }

  const priceUsd =
    fromCurrency === "CNY"
      ? displayPrice / USD_CNY_DISPLAY_RATE
      : displayPrice;
  const converted =
    toCurrency === "CNY"
      ? priceUsd * USD_CNY_DISPLAY_RATE
      : priceUsd;

  return Number(converted.toFixed(4));
}

export function editablePrice(price: number): string {
  return price.toFixed(Math.abs(price) < 1 ? 4 : 2);
}

export function reconcileLimitPriceInput(options: {
  currentInput: string;
  userEdited: boolean;
  previousDisplayCurrency: DisplayCurrency;
  displayCurrency: DisplayCurrency;
  currentQuotePrice: number;
  quoteCurrency: QuoteCurrency;
}): string {
  if (!options.userEdited) {
    const currentDisplayPrice = convertDisplayPrice(
      options.currentQuotePrice,
      options.quoteCurrency,
      options.displayCurrency,
    );
    return editablePrice(currentDisplayPrice);
  }

  if (options.previousDisplayCurrency === options.displayCurrency) {
    return options.currentInput;
  }

  const parsed = parsePositivePrice(options.currentInput);
  if (parsed === null) {
    return options.currentInput;
  }

  return editablePrice(
    convertDisplayPrice(
      parsed,
      options.previousDisplayCurrency,
      options.displayCurrency,
    ),
  );
}
