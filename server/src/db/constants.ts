export const IMPORT_FX_RATES = {
  asOf: "2026-07-23",
  source:
    "Bank of England daily spot rates against USD (CNY 6.7771, HKD 7.8414) and against GBP (CNY 9.0268)",
  sourceUrl:
    "https://www.bankofengland.co.uk/boeapps/database/Rates.asp?Travel=NIxASx&into=USD",
  HKD_CNY: 6.7771 / 7.8414,
  GBP_USD: 9.0268 / 6.7771,
} as const;
