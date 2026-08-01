import { describe, expect, it } from "vitest";
import {
  changeSortLabel,
  nextChangeSort,
} from "../src/marketView.js";

describe("行情涨跌幅排序", () => {
  it("按默认、降序、升序再回到默认循环", () => {
    const descending = nextChangeSort("DEFAULT", "DESC");
    expect(descending).toEqual({
      sortBy: "CHANGE_PERCENT",
      sortOrder: "DESC",
    });

    const ascending = nextChangeSort(
      descending.sortBy,
      descending.sortOrder,
    );
    expect(ascending).toEqual({
      sortBy: "CHANGE_PERCENT",
      sortOrder: "ASC",
    });

    expect(nextChangeSort(ascending.sortBy, ascending.sortOrder)).toEqual({
      sortBy: "DEFAULT",
      sortOrder: "DESC",
    });
  });

  it("排序状态提供清晰中文标签", () => {
    expect(changeSortLabel("DEFAULT", "DESC")).toBe("默认");
    expect(changeSortLabel("CHANGE_PERCENT", "DESC")).toBe("降序");
    expect(changeSortLabel("CHANGE_PERCENT", "ASC")).toBe("升序");
  });
});
