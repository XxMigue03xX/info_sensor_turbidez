export function pickUnit(msSpan) {
  const day   = 86_400_000;
  const month = day * 30;
  const year  = day * 365;

  if (msSpan <= day * 2)          return "hour";
  if (msSpan <= month * 3)        return "day";
  if (msSpan <= year * 2)         return "month";
  return "year";
}