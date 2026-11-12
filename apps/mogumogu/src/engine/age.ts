/** 'YYYY-MM-DD' を UTC の日付として扱う */
export function parseDate(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return { y, m, d };
}
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 満月齢と端数日（要件 PRF-02, 6.2-1） */
export function ageMonthsDays(birth: string, on: string): { months: number; days: number } {
  const b = parseDate(birth);
  const t = parseDate(on);
  let months = (t.y - b.y) * 12 + (t.m - b.m);
  let anchorDay = Math.min(b.d, daysInMonth(t.y, t.m));
  if (t.d < anchorDay) {
    months -= 1;
    const pm = t.m === 1 ? 12 : t.m - 1;
    const py = t.m === 1 ? t.y - 1 : t.y;
    anchorDay = Math.min(b.d, daysInMonth(py, pm));
    const days = daysInMonth(py, pm) - anchorDay + t.d;
    return { months: Math.max(0, months), days };
  }
  return { months: Math.max(0, months), days: t.d - anchorDay };
}

export function formatAge(birth: string, on: string): string {
  const { months, days } = ageMonthsDays(birth, on);
  if (months >= 12) return `${Math.floor(months / 12)}歳${months % 12}か月${days}日`;
  return `${months}か月${days}日`;
}

/** 小数の月齢（成長曲線のプロット用） */
export function ageMonthsDecimal(birth: string, on: string): number {
  const { months, days } = ageMonthsDays(birth, on);
  return months + days / 30.4375;
}

export function addDays(date: string, n: number): string {
  const { y, m, d } = parseDate(date);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
