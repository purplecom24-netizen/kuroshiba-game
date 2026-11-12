/** 食材検索用の正規化（ひらがな・カタカナ・全角半角をそろえる） */
export function normalizeKana(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s　・,，、]/g, '')
    .toLowerCase();
}

export interface SearchItem {
  id: string;
  name: string;
  keys: string; // 正規化済みの検索文字列（名前＋別名）
}

/** 部分一致。最近使った食材を上位、名前の先頭一致・短い名前を優先 */
export function searchFoods<T extends SearchItem>(items: T[], query: string, recent: string[] = [], limit = 40): T[] {
  const terms = query.split(/[\s　]+/).map(normalizeKana).filter(Boolean);
  const recentRank = new Map(recent.map((id, i) => [id, i]));
  if (terms.length === 0) return items.filter((i) => recentRank.has(i.id)).sort((a, b) => recentRank.get(a.id)! - recentRank.get(b.id)!).slice(0, limit);
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    if (!terms.every((t) => item.keys.includes(t))) continue;
    let score = 0;
    const r = recentRank.get(item.id);
    if (r !== undefined) score -= 1000 - r;
    const pos = item.keys.indexOf(terms[0]);
    score += Math.min(pos, 50) + item.name.length * 0.1;
    scored.push({ item, score });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((s) => s.item);
}
