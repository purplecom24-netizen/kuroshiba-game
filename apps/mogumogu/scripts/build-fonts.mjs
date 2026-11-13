// アプリに同梱する丸ゴシック体（M PLUS Rounded 1c）のサブセットを作る（npm run fonts）。
// - 入力: @expo-google-fonts/m-plus-rounded-1c の TTF（SIL Open Font License 1.1）
// - 出力: src/assets/fonts/*.woff2（Medium＝本文、ExtraBold＝見出し・数値）と OFL.txt、public/OFL-MPLUSRounded1c.txt
// 収録文字: ASCII・記号・かな・全角英数・JIS X 0208 の第1/第2水準漢字、
//           それとアプリの参照データに出てくる文字（食品名など）。
//           収録外の文字（絵文字や第3水準以降の漢字）は端末のフォントで表示される。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = path.join(root, 'node_modules', '@expo-google-fonts', 'm-plus-rounded-1c');
const outDir = path.join(root, 'src', 'assets', 'fonts');
fs.mkdirSync(outDir, { recursive: true });

const range = (a, b) => {
  let s = '';
  for (let i = a; i <= b; i++) s += String.fromCodePoint(i);
  return s;
};
// JIS X 0208 の区点（EUC-JP 経由）→ 文字
const eucjp = new TextDecoder('euc-jp');
const jisRows = (r0, r1) => {
  let s = '';
  for (let r = r0; r <= r1; r++) {
    for (let c = 1; c <= 94; c++) {
      const ch = eucjp.decode(new Uint8Array([0xa0 + r, 0xa0 + c]));
      if (ch !== '�' && [...ch].length === 1) s += ch;
    }
  }
  return s;
};

const base =
  range(0x20, 0x7e) + range(0xa0, 0xff) + // ASCII・Latin-1
  range(0x370, 0x3ff) + // ギリシャ文字（μ など）
  range(0x2000, 0x206f) + range(0x2100, 0x218f) + range(0x2190, 0x21ff) + range(0x2200, 0x22ff) + // 約物・矢印・数学記号
  range(0x2460, 0x24ff) + range(0x25a0, 0x25ff) + range(0x2600, 0x266f) + // 丸数字・図形・記号
  range(0x3000, 0x30ff) + range(0x31f0, 0x31ff) + range(0x3200, 0x33ff) + // 句読点・ひらがな・カタカナ・単位記号
  range(0xff00, 0xffef); // 全角英数・半角カナ
const jis = jisRows(1, 13) + jisRows(16, 47) + jisRows(48, 84); // 記号・第1水準・第2水準
// 参照データに出てくる文字は必ず入れる
const dataText = ['foods.json', 'reference.json'].map((f) => fs.readFileSync(path.join(root, 'src', 'data', f), 'utf8')).join('');
const text = [...new Set(base + jis + dataText)].join('');

const targets = [
  { src: '500Medium/MPLUSRounded1c_500Medium.ttf', out: 'mplus-rounded-1c-medium.woff2' },
  { src: '800ExtraBold/MPLUSRounded1c_800ExtraBold.ttf', out: 'mplus-rounded-1c-extrabold.woff2' },
];
for (const t of targets) {
  const ttf = fs.readFileSync(path.join(pkg, t.src));
  const woff2 = await subsetFont(ttf, text, { targetFormat: 'woff2' });
  fs.writeFileSync(path.join(outDir, t.out), woff2);
  console.log(`${t.out}: ${Math.round(woff2.length / 1024)} KB`);
}
fs.copyFileSync(path.join(pkg, 'LICENSE_FONT'), path.join(outDir, 'OFL.txt'));
// 配布物（公開サイト）にもライセンス文書を同梱する（設定タブからリンク）
fs.copyFileSync(path.join(pkg, 'LICENSE_FONT'), path.join(root, 'public', 'OFL-MPLUSRounded1c.txt'));
console.log(`文字数: ${[...text].length}`);
