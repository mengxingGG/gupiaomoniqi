export type MarketSortBy = "DEFAULT" | "CHANGE_PERCENT";
export type MarketSortOrder = "DESC" | "ASC";

export interface MarketSortState {
  sortBy: MarketSortBy;
  sortOrder: MarketSortOrder;
}

/** 默认、涨幅榜、跌幅榜依次循环，第三次点击回到市场原始顺序。 */
export function nextChangeSort(
  sortBy: MarketSortBy,
  sortOrder: MarketSortOrder,
): MarketSortState {
  if (sortBy === "DEFAULT") {
    return { sortBy: "CHANGE_PERCENT", sortOrder: "DESC" };
  }

  if (sortOrder === "DESC") {
    return { sortBy: "CHANGE_PERCENT", sortOrder: "ASC" };
  }

  return { sortBy: "DEFAULT", sortOrder: "DESC" };
}

export function changeSortLabel(
  sortBy: MarketSortBy,
  sortOrder: MarketSortOrder,
): string {
  if (sortBy === "DEFAULT") {
    return "默认";
  }
  return sortOrder === "DESC" ? "降序" : "升序";
}
