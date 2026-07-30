export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function roundPrice(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function roundUnitPrice(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

export function roundPercent(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
