/** 調理状態（要件 MEAL-03）。成分表の食品名末尾の語で判定する */
export const COOK_STATES = ['生', 'ゆで', '水煮', '焼き', '蒸し', '電子レンジ調理', '油いため', 'ソテー', '素揚げ', '天ぷら', 'フライ', '煮', '乾', '缶詰'] as const;

export function splitCookState(name: string): { base: string; state: string | null } {
  const parts = name.split('　');
  const last = parts[parts.length - 1];
  if ((COOK_STATES as readonly string[]).includes(last)) return { base: parts.slice(0, -1).join('　'), state: last };
  return { base: name, state: null };
}
