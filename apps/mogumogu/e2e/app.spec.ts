import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-12T12:00:00+09:00'));
  await page.goto('./');
  await page.getByLabel('名前（ニックネーム可）').fill('はな');
  await page.getByLabel('生年月日').fill('2026-04-02');
  await page.getByRole('button', { name: '女の子' }).click();
  await page.getByRole('button', { name: '混合' }).click();
  await page.getByRole('button', { name: '登録してはじめる' }).click();
  await expect(page.locator('.header')).toContainText('7か月10日');
}

async function addFormula(page: Page) {
  await page.getByRole('tab', { name: '食材' }).or(page.getByRole('button', { name: '食材', exact: true })).click();
  await page.getByRole('button', { name: 'ミルク銘柄' }).click();
  await page.getByRole('button', { name: '＋ 銘柄を追加' }).click();
  await page.getByRole('button', { name: 'その他の銘柄（缶の表示を手入力）' }).click();
  await page.getByLabel('商品名').fill('テストミルク');
  await page.getByLabel('鉄 100mlあたり').fill('0.8');
  await page.getByLabel('エネルギー 100mlあたり').fill('67');
  await page.getByRole('button', { name: '保存' }).click();
  await page.getByRole('button', { name: '記録', exact: true }).click();
  await page.getByRole('button', { name: '＋ ミルク' }).click();
  await page.getByLabel('銘柄').selectOption({ label: 'テストミルク' });
  await page.getByLabel('作った量').fill('250');
  await page.getByRole('button', { name: '保存' }).click();
}

async function addFood(page: Page, query: string, pick: RegExp, grams: string) {
  await page.getByLabel('食材を検索').fill(query);
  await page.getByRole('listitem').filter({ hasText: pick }).first().click();
  await page.getByLabel('提供量').fill(grams);
  await page.getByRole('button', { name: '保存' }).click();
}

test('記録 → 栄養分析 → 一覧（T-11, T-16）', async ({ page }) => {
  await setup(page);
  await addFormula(page);
  await page.getByRole('button', { name: '＋ 食事' }).click();
  await addFood(page, 'さつまいも 蒸し', /皮なし　蒸し/, '20');
  await page.getByRole('button', { name: '＋ 食材を追加' }).click();
  await addFood(page, '鯖 焼き', /^まさば　焼き/, '10');
  // よく使う食材から7倍がゆ（成分表にないため推定値）
  await page.getByRole('button', { name: '＋ 食材を追加' }).click();
  await page.getByLabel('食材を検索').fill('おかゆ');
  await expect(page.getByRole('dialog').getByRole('listitem').first()).toContainText('倍がゆ');
  await page.screenshot({ path: 'e2e-results/picker-okayu.png' });
  await page.getByRole('dialog').getByRole('listitem').filter({ hasText: /^7倍がゆ/ }).click();
  await expect(page.getByText('全かゆ（5倍）を米の量で比例換算')).toBeVisible();
  await page.getByLabel('提供量').fill('30');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.locator('.card').filter({ hasText: '1回目' })).toContainText('7倍がゆ');
  await expect(page.locator('.card').filter({ hasText: '1回目' })).toContainText('60 g');
  await expect(page.locator('.kv')).toContainText('250 ml');

  await page.getByRole('button', { name: '栄養分析' }).click();
  await page.getByRole('button', { name: '今日' }).click();
  await expect(page.getByTestId('focus-iron')).toContainText('推奨量比');
  // T-11: ミルク由来2.00mg＋母乳＋離乳食 → 2mg台
  await expect(page.getByTestId('focus-iron').locator('.big')).toHaveText(/^≥?2\.\d+ mg$/);
  await expect(page.getByTestId('focus-iron')).toContainText('あと');
  // T-16: 一覧に全栄養素
  const table = page.getByTestId('nutrient-table');
  await expect(table.locator('tbody tr')).toHaveCount(32);
  await expect(table).toContainText('目安量');
  await expect(table).toContainText('推奨量');
  // 脂質はエネルギー比（%）で表示し、「%E」という表記は出さない
  const fat = page.getByTestId('row-fat');
  await expect(fat).toContainText('エネルギー比');
  await expect(fat.locator('.nut-val .v')).toHaveText(/^≥?\d+ \/ 40 %$/);
  await expect(fat.locator('.nut-ratio .v')).toHaveText(/^\d+%$/);
  await expect(table).not.toContainText('%E');
  // 数値の行は折り返さない
  for (const id of ['energy', 'protein', 'fat']) {
    const h = (await page.getByTestId(`row-${id}`).locator('.nut-val .v').boundingBox())!.height;
    expect(h).toBeLessThan(30);
  }
  await expect(page.getByText('医療的な判断の代わりにはなりません').first()).toBeVisible();
  await page.screenshot({ path: 'e2e-results/analysis.png', fullPage: true });
});

test('成長曲線と相談の目安（T-13）', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '成長', exact: true }).click();
  await page.getByLabel('計測日').fill('2026-11-10');
  await page.getByLabel('体重', { exact: true }).fill('5.6');
  await page.getByLabel('身長', { exact: true }).fill('66.0');
  await page.getByRole('button', { name: '記録する' }).click();
  await expect(page.getByTestId('consult')).toContainText('健診や小児科で相談する目安');
  await expect(page.locator('body')).not.toContainText(/異常|病気|欠乏症/);
  await page.screenshot({ path: 'e2e-results/growth.png', fullPage: true });
});

test('オフラインで動く（T-14）', async ({ page, context }) => {
  await setup(page);
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active);
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  // 丸ゴシック体は事前キャッシュから読み込まれる
  expect(await page.evaluate(async () => { await document.fonts.load('16px "M PLUS Rounded 1c"', 'あ鉄1'); await document.fonts.load('800 16px "M PLUS Rounded 1c"', 'あ鉄1'); return document.fonts.check('16px "M PLUS Rounded 1c"', 'あ鉄1') && document.fonts.check('800 16px "M PLUS Rounded 1c"', 'あ鉄1'); })).toBe(true);
  await page.getByRole('button', { name: '＋ 授乳' }).click();
  await expect(page.locator('.kv')).toContainText('授乳1回');
  await page.getByRole('button', { name: '＋ 食事' }).click();
  await expect(page.getByText('よく使う食材')).toBeVisible();
  await page.screenshot({ path: 'e2e-results/picker-empty.png' });
  await addFood(page, 'にんじん ゆで', /にんじん　根　皮なし　ゆで/, '15');
  await page.getByRole('button', { name: '栄養分析' }).click();
  await expect(page.getByTestId('nutrient-table')).toBeVisible();
  await page.getByRole('button', { name: '成長', exact: true }).click();
  await expect(page.getByText('体重の発育曲線')).toBeVisible();
});

test('JSONバックアップ → 全削除 → 復元（T-15）', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '＋ 授乳' }).click();
  await page.getByRole('button', { name: '設定' }).click();
  await page.getByLabel('母乳の既定値').fill('500');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'JSONで書き出す' }).click()]);
  const path = await dl.path();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '全データを削除' }).click();
  await expect(page.getByRole('button', { name: '登録してはじめる' })).toBeVisible();
  // 復元はプロフィール登録前の画面からはできないので、仮登録してから読み込む
  await page.getByLabel('名前（ニックネーム可）').fill('tmp');
  await page.getByLabel('生年月日').fill('2025-01-01');
  await page.getByRole('button', { name: '登録してはじめる' }).click();
  await page.getByRole('button', { name: '設定' }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('import-file').setInputFiles(path!);
  await expect(page.getByRole('status')).toContainText('読み込みました');
  await expect(page.locator('.header')).toContainText('はな');
  await expect(page.getByLabel('母乳の既定値')).toHaveValue('500');
  await page.getByRole('button', { name: '記録', exact: true }).click();
  await expect(page.locator('.kv')).toContainText('授乳1回');
});

test('数字を1文字ずつ打てる（大さじの重さ15g・体重6.25kg）', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '＋ 食事' }).click();
  await page.getByRole('dialog').getByRole('listitem').filter({ hasText: /^7倍がゆ/ }).click();
  await page.getByLabel('提供量').pressSequentially('5');
  await page.getByLabel('単位').selectOption('tsp');
  const d = page.getByLabel('大さじ1杯の重さ');
  await d.click();
  await d.pressSequentially('15', { delay: 50 });
  await expect(d).toHaveValue('15');
  await expect(d).toBeVisible();
  // 小さじ5杯 = 25ml × (15g/15ml) = 25g
  await expect(page.getByRole('dialog')).toContainText('提供 25 g');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.locator('.card').filter({ hasText: '1回目' })).toContainText('25 g');

  await page.getByRole('button', { name: '成長', exact: true }).click();
  const w = page.getByLabel('体重', { exact: true });
  await w.pressSequentially('6.25', { delay: 50 });
  await expect(w).toHaveValue('6.25');
  await page.getByRole('button', { name: '記録する' }).click();
  await expect(page.getByText('最新の体重：6.25 kg')).toBeVisible();
});

test('記録タブ：横スワイプで日付切替、日付を変えてもボタン位置が変わらない', async ({ page }) => {
  await setup(page);
  const next = page.getByRole('button', { name: '次の日' });
  const date = page.getByLabel('日付', { exact: true });
  const before = await next.boundingBox();
  const dateBefore = await date.boundingBox();

  const swipe = async (fromX: number, toX: number) => {
    await page.evaluate(([a, b]) => {
      const el = document.querySelector('.swipe-area')!;
      const mk = (x: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY: 400 });
      el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [mk(a)], changedTouches: [mk(a)] }));
      el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [mk(b)] }));
    }, [fromX, toX]);
  };
  await swipe(300, 100); // 左へ → 翌日
  await expect(date).toHaveValue('2026-11-13');
  await expect(page.getByRole('button', { name: '今日に戻る' })).toBeVisible();
  expect(await next.boundingBox()).toEqual(before);
  expect(await date.boundingBox()).toEqual(dateBefore);
  await swipe(100, 300); // 右へ → 前日
  await swipe(100, 300);
  await expect(date).toHaveValue('2026-11-11');
  await swipe(10, 300); // 画面端からは無視（iOSの戻る操作）
  await expect(date).toHaveValue('2026-11-11');
  await page.getByRole('button', { name: '今日に戻る' }).click();
  await expect(date).toHaveValue('2026-11-12');
  await expect(page.getByRole('button', { name: '今日に戻る' })).toHaveCount(0);
  expect(await next.boundingBox()).toEqual(before);
  // iOS Safari の日付欄は独自の最小幅を持つ → 強制しても「▶」と重ならない
  await page.addStyleTag({ content: "input[type='date'] { min-width: 300px !important; }" });
  const cell = await page.locator('.date-cell').boundingBox();
  const nb = (await next.boundingBox())!;
  const pb = (await page.getByRole('button', { name: '前の日' }).boundingBox())!;
  expect(cell!.x + cell!.width).toBeLessThanOrEqual(nb.x);
  expect(cell!.x).toBeGreaterThanOrEqual(pb.x + pb.width);
  expect(Math.round(cell!.height)).toBe(Math.round(nb.height));
  // 日付の文字は枠の上下中央
  const lb = (await page.locator('.date-label').boundingBox())!;
  expect(Math.abs(lb.y + lb.height / 2 - (cell!.y + cell!.height / 2))).toBeLessThan(2);
  await expect(page.locator('.date-label')).toHaveText('2026/11/12（木）');
  await page.screenshot({ path: 'e2e-results/record-nav.png' });
});

test('ミルクはメーカーの商品から選べる（ほほえみ250ml → 鉄2mg台）', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '＋ ミルク' }).click();
  await page.getByLabel('銘柄').selectOption({ label: '明治ほほえみ（粉・らくらくキューブ）（明治）' });
  await expect(page.getByLabel('銘柄')).toHaveValue(/^\d+$/);
  await page.getByLabel('作った量').pressSequentially('250');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.locator('.card').filter({ hasText: 'ミルク・授乳' })).toContainText('明治ほほえみ');
  await page.getByRole('button', { name: '栄養分析' }).click();
  await page.getByRole('button', { name: '今日' }).click();
  await expect(page.getByTestId('focus-iron').locator('.big')).toHaveText(/^≥?2\.\d+ mg$/);
  await page.getByRole('button', { name: '食材', exact: true }).click();
  await page.getByRole('button', { name: 'ミルク銘柄' }).click();
  await expect(page.getByText('公式表示')).toBeVisible();
  await page.getByRole('button', { name: '＋ 銘柄を追加' }).click();
  await page.screenshot({ path: 'e2e-results/formula-presets.png', fullPage: true });
});

test('栄養分析：任意でカレンダーから単日・複数日を選んで平均', async ({ page }) => {
  await setup(page);
  // 11/10 と 11/12 にミルクを記録
  for (const [d, ml] of [['2026-11-10', '200'], ['2026-11-12', '300']]) {
    await page.getByLabel('日付', { exact: true }).fill(d);
    await page.getByRole('button', { name: '＋ ミルク' }).click();
    await page.getByLabel('銘柄').selectOption({ label: '明治ほほえみ（粉・らくらくキューブ）（明治）' });
    await page.getByLabel('作った量').pressSequentially(ml);
    await page.getByRole('button', { name: '保存' }).click();
  }
  await page.getByRole('button', { name: '栄養分析' }).click();
  await page.getByRole('button', { name: '任意' }).click();
  const cal = page.getByTestId('multi-cal');
  await expect(cal.getByRole('button', { name: '11月10日（記録あり）' })).toBeVisible();
  // 既定は今日（11/12）だけ → 単日
  await expect(page.getByText('11/12（木）・記録のある1日')).toBeVisible();
  await cal.getByRole('button', { name: '11月10日（記録あり）' }).click();
  await cal.getByRole('button', { name: '11月11日', exact: true }).click(); // 記録なし → 既定で除外
  await expect(page.getByText(/3日を選択.*記録のある2日の平均/)).toBeVisible();
  // ミルク鉄 (200+300)/2ml × 0.81/100 + 母乳
  await expect(page.getByTestId('focus-iron').locator('.big')).toContainText('mg');
  await cal.getByRole('button', { name: 'クリア' }).click();
  await expect(page.getByText('日付を選んでください')).toBeVisible();
  await expect(cal.getByRole('button', { name: '次の月' })).toBeDisabled();
  await cal.getByRole('button', { name: '11月12日（記録あり）' }).click();
  await page.screenshot({ path: 'e2e-results/analysis-custom.png', fullPage: true });
});

test('タブバー：半透明のカプセル、なぞって切替、キーボードでも切替', async ({ page }) => {
  await setup(page);
  const bar = page.locator('.tabbar');
  const glass = await page.locator('.tabbar-glass').evaluate((el) => {
    const s = getComputedStyle(el);
    return { blur: (s.backdropFilter || (s as unknown as Record<string, string>).webkitBackdropFilter || '').includes('blur'), radius: parseFloat(s.borderTopLeftRadius), alpha: s.backgroundColor };
  });
  expect(glass.blur).toBe(true);
  expect(glass.radius).toBeGreaterThan(20);
  expect(glass.alpha).not.toMatch(/^rgb\(/); // 不透明（rgb）ではなく半透明
  // 画面の左右に余白があり、浮いている
  const box = (await bar.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(12);
  expect(vp.width - (box.x + box.width)).toBeGreaterThanOrEqual(12);
  expect(vp.height - (box.y + box.height)).toBeGreaterThanOrEqual(8);

  // 選択中カプセルは選択タブの位置にある
  const lensOver = async (name: string) => {
    const b = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
    const l = (await page.locator('.tab-lens').boundingBox())!;
    return Math.abs(l.x + l.width / 2 - (b.x + b.width / 2));
  };
  await expect.poll(() => lensOver('記録')).toBeLessThan(3);

  // なぞって切替：記録 → 設定まで動かして離す
  const items = (await page.locator('.tabbar-items').boundingBox())!;
  const y = items.y + items.height / 2;
  await page.mouse.move(items.x + items.width * 0.1, y);
  await page.mouse.down();
  await expect(bar).toHaveClass(/dragging/);
  await page.mouse.move(items.x + items.width * 0.5, y, { steps: 5 });
  await expect(page.getByRole('button', { name: '栄養分析', exact: true })).toHaveClass(/under-lens/);
  await page.mouse.move(items.x + items.width * 0.9, y, { steps: 5 });
  await page.mouse.up();
  await expect(bar).not.toHaveClass(/dragging/);
  await expect(page.getByRole('button', { name: '設定', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('子どもプロフィール')).toBeVisible();
  await expect.poll(() => lensOver('設定')).toBeLessThan(3);

  // タップで切替
  await page.getByRole('button', { name: '成長', exact: true }).click();
  await expect(page.getByText('体重の発育曲線')).toBeVisible();

  // 指でなぞって切替（タッチ）：成長 → 記録
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y) }] });
  await touch('touchStart', items.x + items.width * 0.7);
  await expect(bar).toHaveClass(/dragging/);
  for (const f of [0.6, 0.45, 0.3, 0.12]) await touch('touchMove', items.x + items.width * f);
  await expect(page.getByRole('button', { name: '記録', exact: true })).toHaveClass(/under-lens/);
  await touch('touchEnd');
  await expect(bar).not.toHaveClass(/dragging/);
  await expect(page.getByRole('button', { name: '記録', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: '＋ 食事' })).toBeVisible();
  // 指でタップ
  await page.touchscreen.tap(items.x + items.width * 0.5, y);
  await expect(page.getByRole('button', { name: '栄養分析', exact: true })).toHaveAttribute('aria-current', 'page');

  // キーボードで切替
  await page.getByRole('button', { name: '食材', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '食材', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: 'ミルク銘柄' })).toBeVisible();

  // フォント
  expect(await page.evaluate(async () => { await document.fonts.ready; return getComputedStyle(document.body).fontFamily; })).toContain('M PLUS Rounded 1c');
});
