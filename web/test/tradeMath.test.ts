import { describe, expect, it } from "vitest";
import {
  convertDisplayPrice,
  displayPriceToQuote,
  parsePositivePrice,
  reconcileLimitPriceInput,
} from "../src/tradeMath.js";

describe("tradeMath", () => {
  it("只接受大于零的有限限价", () => {
    expect(parsePositivePrice("")).toBeNull();
    expect(parsePositivePrice("0")).toBeNull();
    expect(parsePositivePrice("-1")).toBeNull();
    expect(parsePositivePrice("Infinity")).toBeNull();
    expect(parsePositivePrice(" 12.34 ")).toBe(12.34);
  });

  it("把统一显示美元转换为人民币报价", () => {
    expect(displayPriceToQuote(10, "USD", "CNY")).toBe(70);
  });

  it("把统一显示人民币转换为美元报价", () => {
    expect(displayPriceToQuote(70, "CNY", "USD")).toBe(10);
  });

  it("同币种输入保持原值并限制为四位小数", () => {
    expect(displayPriceToQuote(12.345678, "USD", "USD")).toBe(
      12.3457,
    );
    expect(displayPriceToQuote(88.123456, "CNY", "CNY")).toBe(
      88.1235,
    );
  });

  it("切换显示币种时按固定汇率转换已编辑的限价", () => {
    expect(convertDisplayPrice(12.5, "USD", "CNY")).toBe(87.5);
    expect(
      reconcileLimitPriceInput({
        currentInput: "12.50",
        userEdited: true,
        previousDisplayCurrency: "USD",
        displayCurrency: "CNY",
        currentQuotePrice: 13,
        quoteCurrency: "USD",
      }),
    ).toBe("87.50");
  });

  it("最新报价只更新未编辑的默认限价", () => {
    expect(
      reconcileLimitPriceInput({
        currentInput: "70.00",
        userEdited: false,
        previousDisplayCurrency: "CNY",
        displayCurrency: "CNY",
        currentQuotePrice: 11,
        quoteCurrency: "USD",
      }),
    ).toBe("77.00");
    expect(
      reconcileLimitPriceInput({
        currentInput: "75.25",
        userEdited: true,
        previousDisplayCurrency: "CNY",
        displayCurrency: "CNY",
        currentQuotePrice: 11,
        quoteCurrency: "USD",
      }),
    ).toBe("75.25");
  });

  it("用户主动清空限价后切换币种仍保持为空", () => {
    expect(
      reconcileLimitPriceInput({
        currentInput: "",
        userEdited: true,
        previousDisplayCurrency: "USD",
        displayCurrency: "CNY",
        currentQuotePrice: 11,
        quoteCurrency: "USD",
      }),
    ).toBe("");
  });
});
