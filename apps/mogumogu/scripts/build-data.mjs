// 参照データの変換スクリプト（ビルド前に一度だけ実行: npm run data）
// 一次ソースの Excel / 転記CSV → src/data/*.json
// 数値の丸め・補完はしない。成分表の記号（Tr, (Tr), (0), -, 推定値の括弧）は文字列のまま保持し、
// 解釈はアプリ側の純粋関数 parseToken()（src/engine/token.ts）で行う。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => path.join(root, 'data-src', f);
const outDir = path.join(root, 'src', 'data');
fs.mkdirSync(outDir, { recursive: true });

function readCsv(file) {
  const lines = fs.readFileSync(src(file), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const head = lines.shift().split(',');
  return lines.map((l) => {
    const cells = l.split(',');
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? '']));
  });
}

// ---------- 栄養素定義 ----------
const nutrients = readCsv('nutrients.csv').map((r) => ({
  id: r.id,
  nameJa: r.nameJa,
  shortJa: r.shortJa,
  unit: r.unit,
  group: r.group,
  mextColumn: r.mextColumn,
  sortOrder: Number(r.sortOrder),
  note: r.note || undefined,
}));

// ---------- 食品成分表 ----------
const MEXT_FILE = 'mext_seibun_2023_ch2.xlsx';
const wb = XLSX.readFile(src(MEXT_FILE));
const ws = wb.Sheets[wb.SheetNames[0]]; // 表全体
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
const idRowIdx = rows.findIndex((r) => r && r.includes('ENERC_KCAL'));
if (idRowIdx < 0) throw new Error('成分識別子の行が見つかりません');
const idRow = rows[idRowIdx].map((c) => (typeof c === 'string' ? c.trim() : c));
const colOf = (ident) => {
  const i = idRow.indexOf(ident);
  if (i < 0) throw new Error(`成分識別子 ${ident} が見つかりません`);
  return i;
};
const nameCol = colOf('REFUSE') - 1; // 食品名は廃棄率の左
const refuseCol = colOf('REFUSE');
const nutrientCols = nutrients.map((n) => colOf(n.mextColumn));
const remarkCol = idRow.length - 1 - [...idRow].reverse().findIndex((c) => c === 'NACL_EQ') + 1; // 備考
const updated = rows.slice(0, idRowIdx).flat().find((c) => typeof c === 'string' && c.includes('更新日')) || '';

const tok = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  return String(v).trim();
};
const foods = [];
for (const r of rows.slice(idRowIdx + 1)) {
  if (!r || !r[1] || !/^\d{5}$/.test(String(r[1]).trim())) continue;
  const name = String(r[nameCol]).replace(/\s+/g, '　').trim();
  const remark = r[remarkCol] ? String(r[remarkCol]) : '';
  const alias = (remark.match(/別名[:：]\s*([^\n]+)/) || [])[1] || '';
  foods.push([
    String(r[1]).trim(),
    String(r[0]).trim(),
    name,
    alias.replace(/\s+/g, ''),
    ...nutrientCols.map((c) => tok(r[c])),
  ]);
}
const human = foods.find((f) => f[0] === '13051');
if (!human) throw new Error('13051 人乳 が見つかりません');

fs.writeFileSync(
  path.join(outDir, 'foods.json'),
  JSON.stringify({
    dataset: 'mext',
    version: '日本食品標準成分表（八訂）増補2023年',
    updated: updated.replace('更新日：', ''),
    file: MEXT_FILE,
    columns: ['code', 'group', 'name', 'alias', ...nutrients.map((n) => n.id)],
    foods,
  }),
);

// ---------- 食事摂取基準 ----------
const intake = readCsv('intake_reference.csv').map((r) => ({
  nutrientId: r.nutrientId,
  ageMinMonths: Number(r.ageMinMonths),
  ageMaxMonths: Number(r.ageMaxMonths),
  sex: r.sex,
  kind: r.kind,
  value: Number(r.value),
  unit: r.unit,
  source: r.source,
  page: Number(r.page),
}));
for (const r of intake) {
  if (!nutrients.some((n) => n.id === r.nutrientId)) throw new Error(`未知の栄養素 ${r.nutrientId}`);
  if (!Number.isFinite(r.value)) throw new Error(`値が不正 ${JSON.stringify(r)}`);
}

// ---------- 母乳中濃度 ----------
const SG = 1.017; // 母乳の比重（DRI2025 乳児 表1 脚注1）
const nIndex = Object.fromEntries(nutrients.map((n, i) => [n.id, i]));
const breastmilk = readCsv('breastmilk.csv').map((r) => {
  if (r.perL === 'MEXT') {
    const t = human[4 + nIndex[r.nutrientId]];
    return {
      nutrientId: r.nutrientId,
      ageMinMonths: Number(r.ageMinMonths),
      ageMaxMonths: Number(r.ageMaxMonths),
      per100g: t, // 記号を保持したまま。アプリ側で ×10×比重 して /L にする
      perL: null,
      specificGravity: SG,
      source: '日本食品標準成分表（八訂）増補2023年 13051 人乳',
      flag: 'mext',
    };
  }
  return {
    nutrientId: r.nutrientId,
    ageMinMonths: Number(r.ageMinMonths),
    ageMaxMonths: Number(r.ageMaxMonths),
    per100g: null,
    perL: Number(r.perL),
    specificGravity: SG,
    source: `日本人の食事摂取基準（2025年版） ${r.source.replace('DRI2025 ', '')}`,
    flag: r.flag || '',
  };
});

// ---------- 発育曲線 ----------
const zen = (s) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
function ageOf(label) {
  const s = zen(String(label)).replace(/\s/g, '');
  if (s.startsWith('出生時')) return 0;
  let m = s.match(/^(\d+)日$/);
  if (m) return Number(m[1]) / 30.4375;
  m = s.match(/^(?:(\d+)年)?(\d+)～(\d+)月未満$/);
  if (m) {
    const y = m[1] ? Number(m[1]) : null;
    const a = Number(m[2]);
    const b = Number(m[3]);
    // 「１年０～６月未満」は年+月。「２～３月未満」（年の表記なし）は0年の続き
    const base = y !== null ? y * 12 : 0;
    return base + (a + b) / 2; // 区間の中央の月齢にプロットする
  }
  throw new Error(`月齢ラベルを解釈できません: ${label}`);
}
function readGrowth(file, metric) {
  const w = XLSX.readFile(src(file));
  const rs = XLSX.utils.sheet_to_json(w.Sheets[w.SheetNames[0]], { header: 1, raw: true, defval: null });
  const title = String(rs[0][0]).trim();
  const out = [];
  for (const r of rs) {
    if (!r || typeof r[0] !== 'string' || typeof r[1] !== 'number') continue;
    const age = ageOf(r[0]);
    const p = (o) => r.slice(o, o + 7).map((v) => Math.round(v * 1000) / 1000);
    out.push({ sex: 'M', metric, label: r[0].trim(), ageMonths: Math.round(age * 1000) / 1000, p: p(1) });
    out.push({ sex: 'F', metric, label: r[0].trim(), ageMonths: Math.round(age * 1000) / 1000, p: p(8) });
  }
  return { title, rows: out };
}
const gw = readGrowth('growth_r5_weight.xlsx', 'weight');
const gh = readGrowth('growth_r5_height.xlsx', 'height');
const gc = readGrowth('growth_r5_head.xlsx', 'head');

fs.writeFileSync(
  path.join(outDir, 'reference.json'),
  JSON.stringify(
    {
      nutrients,
      intake,
      breastmilk,
      growth: {
        percentiles: [3, 10, 25, 50, 75, 90, 97],
        rows: [...gw.rows, ...gh.rows, ...gc.rows],
      },
      breastMilkVolume: readCsv('breastmilk_volume.csv').map((r) => ({ ageMinMonths: Number(r.ageMinMonths), ageMaxMonths: Number(r.ageMaxMonths), ml: Number(r.ml), source: r.source })),
      formulas: (() => {
        // 育児用ミルクの公式成分表示。範囲表示は下限値、食塩相当量からナトリウムを換算（Na mg = 食塩相当量 g × 1000 / 2.54）
        const by = new Map();
        for (const r of readCsv('formula_products.csv')) {
          const p = by.get(r.id) ?? {
            id: r.id, maker: r.maker, name: r.name, type: r.type, targetAge: r.targetAge,
            gramsPer100ml: r.gramsPer100ml ? Number(r.gramsPer100ml) : null,
            concSource: r.concSource || '', sourceUrl: r.sourceUrl, checkedAt: '2026-11-12',
            per100g: {}, per100ml: {}, ranges: [],
          };
          const target = r.basis === '100g' ? p.per100g : p.per100ml;
          for (const n of nutrients) {
            const raw = r[n.id];
            if (raw === undefined || raw === '') continue;
            const m = raw.match(/^([\d.]+)~([\d.]+)$/);
            if (m) {
              target[n.id] = Number(m[1]);
              if (!p.ranges.includes(n.id)) p.ranges.push(n.id);
            } else {
              const v = Number(raw);
              if (!Number.isFinite(v)) throw new Error(`ミルクの値が不正: ${r.id} ${n.id}=${raw}`);
              target[n.id] = v;
            }
          }
          if (target.salt !== undefined && target.sodium === undefined) target.sodium = Math.round((target.salt * 1000 / 2.54) * 1000) / 1000;
          by.set(r.id, p);
        }
        return [...by.values()];
      })(),
      presets: readCsv('babyfood_presets.csv').map((r) => {
        if (!foods.some((f) => f[0] === r.code)) throw new Error(`プリセットの食品番号が見つかりません: ${r.code}`);
        return { id: r.id, label: r.label, category: r.category, aliases: r.aliases.split('|'), code: r.code, scale: Number(r.scale), note: r.note || '' };
      }),
      aliases: readCsv('aliases.csv').map((r) => ({ key: r.key, aliases: r.aliases.split('|') })),
      versions: [
        {
          dataset: '食品成分',
          version: '日本食品標準成分表（八訂）増補2023年（正誤表 2026年3月27日反映版）',
          publisher: '文部科学省',
          sourceUrl: 'https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html',
          note: `第2章データ（Excel）${updated}`,
        },
        {
          dataset: '食事摂取基準',
          version: '日本人の食事摂取基準（2025年版）策定検討会報告書（2024年10月11日公表）',
          publisher: '厚生労働省',
          sourceUrl: 'https://www.mhlw.go.jp/stf/newpage_44138.html',
          note: '2-2 乳児・小児 表3（p.375）を転記。正誤表（令和7年3月25日）で乳児表の訂正なしを確認',
        },
        {
          dataset: '母乳中濃度',
          version: '日本人の食事摂取基準（2025年版）2-2 乳児・小児 表1（p.368）／未掲載の栄養素は成分表 13051 人乳',
          publisher: '厚生労働省・文部科学省',
          sourceUrl: 'https://www.mhlw.go.jp/stf/newpage_44138.html',
          note: 'ビタミンDは2025年版の表1に母乳中濃度の記載がないため、成分表の人乳の値を使用',
        },
        {
          dataset: '育児用ミルク',
          version: '明治・森永乳業・雪印ビーンスターク・和光堂・江崎グリコの公式サイトの栄養成分表示（2026年11月12日確認）',
          publisher: '各社',
          sourceUrl: 'https://www.meiji.co.jp/products/milkpowder/',
          note: '範囲表示の成分は下限値で計算。ナトリウムは食塩相当量から換算。商品のリニューアルで変わることがあるため、缶の表示と違う場合は銘柄を編集してください',
        },
        {
          dataset: '発育曲線',
          version: 'こども家庭庁「令和5年乳幼児身体発育調査」（2024年12月25日公表）',
          publisher: 'こども家庭庁',
          sourceUrl: 'https://www.e-stat.go.jp/stat-search/files?page=1&toukei=00450272&tstat=000001024533',
          note: `${gw.title} / ${gh.title} / ${gc.title}`,
        },
      ],
    },
    null,
    1,
  ),
);

console.log(`foods: ${foods.length}, intake rows: ${intake.length}, breastmilk: ${breastmilk.length}, growth rows: ${gw.rows.length + gh.rows.length + gc.rows.length}`);
