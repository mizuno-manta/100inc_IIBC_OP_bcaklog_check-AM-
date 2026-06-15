'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────────────────────
// ⚠ スクレイピング実装メモ（要・実機検証）
//   - Backlog の DOM はスペース/テーマ/バージョンで差異があります。
//   - ログインは「標準 /login（1画面でID＋パスワード）→ 2要素認証(TOTP)コード入力」方式。
//     TOTP は必須（BACKLOG_TOTP_SECRET）。
//   - 本実装は「ログイン → /find/{PROJECT_KEY} の結果テーブルをヘッダー名から
//     列を特定して各行を抽出」という、列順に依存しにくい方式を採用しています。
//   - 初回は `node src/run.js morning --debug` で debug/ に HTML/スクショを保存し、
//     実際の DOM に合わせてセレクタ/ヘッダー名を微調整してください。
// ─────────────────────────────────────────────────────────────────────────────

// 標準ステータスID（プロジェクトでカスタムしている場合は要調整）
const STATUS_ID = { 未対応: 1, 処理中: 2, 処理済み: 3, 完了: 4 };

function debugDir() {
  const dir = path.join(process.cwd(), 'debug');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** RFC6238 TOTP（2FA 用、Base32 シークレットから 6 桁コード生成） */
function totp(base32Secret) {
  const key = base32Decode(base32Secret.replace(/\s/g, '').toUpperCase());
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(code % 1_000_000).padStart(6, '0');
}

function base32Decode(s) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of s.replace(/=+$/, '')) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

async function trySelectors(page, selectors) {
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) return el;
  }
  return null;
}

async function login(page, env, { debug } = {}) {
  const url = `${env.spaceUrl}/login`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: env.navTimeoutMs });

  // ユーザーID
  const idField = await trySelectors(page, [
    'input#userId',
    'input[name="userId"]',
    'input[name="loginId"]',
    'input[name="email"]',
    'input[type="email"]',
  ]);
  if (!idField) {
    if (debug) await dumpDebug(page, 'login-no-id-field');
    throw new Error('ログインフォームのID入力欄が見つかりません（セレクタ要確認: debug/ を参照）');
  }
  await idField.fill(env.loginId);

  // パスワード（同一画面にある場合）
  let pwField = await trySelectors(page, ['input#password', 'input[name="password"]', 'input[type="password"]']);
  if (!pwField) {
    // 2段階フォーム: ID 入力後に「次へ」
    const next = await trySelectors(page, ['button[type="submit"]', 'button#login', 'input#login']);
    if (next) {
      await next.click();
      await page.waitForLoadState('domcontentloaded', { timeout: env.navTimeoutMs }).catch(() => {});
    }
    pwField = await trySelectors(page, ['input#password', 'input[name="password"]', 'input[type="password"]']);
  }
  if (!pwField) {
    if (debug) await dumpDebug(page, 'login-no-pw-field');
    throw new Error('ログインフォームのパスワード入力欄が見つかりません（セレクタ要確認: debug/ を参照）');
  }
  await pwField.fill(env.password);

  const submit = await trySelectors(page, ['button#login', 'input#login', 'button[type="submit"]', 'input[type="submit"]']);
  if (submit) await submit.click();
  await page.waitForLoadState('networkidle', { timeout: env.navTimeoutMs }).catch(() => {});

  // 2FA(TOTP): 標準ログインでは必須。パスワード送信後にコード入力画面へ遷移する。
  // 画面遷移が非同期のことがあるため、OTP 欄の出現を明示的に待つ（最大10秒）。
  const otpSelector = [
    'input[name="otp"]',
    'input[name="code"]',
    'input[name="userOtp"]',
    'input[name="oneTimePassword"]',
    'input#otp',
    'input[autocomplete="one-time-code"]',
  ].join(', ');
  await page
    .waitForSelector(otpSelector, { timeout: Math.min(env.navTimeoutMs, 10000) })
    .catch(() => {});
  const otpField = await page.$(otpSelector);
  if (otpField) {
    if (!env.totpSecret) {
      if (debug) await dumpDebug(page, 'login-2fa-required');
      throw new Error('2要素認証が要求されましたが BACKLOG_TOTP_SECRET が未設定です');
    }
    await otpField.fill(totp(env.totpSecret));
    const otpSubmit = await trySelectors(page, [
      'button[type="submit"]',
      'button#login',
      'input[type="submit"]',
      'input#submit',
    ]);
    if (otpSubmit) await otpSubmit.click();
    await page.waitForLoadState('networkidle', { timeout: env.navTimeoutMs }).catch(() => {});
  }

  // ログイン成否の簡易判定: /login に留まっていないか
  if (page.url().includes('/login')) {
    if (debug) await dumpDebug(page, 'login-failed');
    throw new Error('ログインに失敗した可能性があります（/login に留まっています）');
  }
}

function buildFindUrl(spaceUrl, projectKey, fetchStatuses) {
  const statusIds = fetchStatuses
    .map((s) => STATUS_ID[s])
    .filter((v) => v != null);
  const params = new URLSearchParams();
  params.set('sort', 'DUE_DATE');
  params.set('order', 'false');
  params.set('count', '100');
  let qs = params.toString();
  for (const id of statusIds) qs += `&statusId%5B%5D=${id}`;
  return `${spaceUrl}/find/${encodeURIComponent(projectKey)}?${qs}`;
}

/** 結果テーブルから課題行を抽出（ヘッダー名で列を特定） */
async function extractRows(page, spaceUrl, projectKey, projectLabel) {
  return page.evaluate(
    ({ spaceUrl, projectKey, projectLabel }) => {
      function txt(el) {
        return (el ? el.textContent : '').replace(/\s+/g, ' ').trim();
      }
      const table =
        document.querySelector('table.list') ||
        document.querySelector('#list table') ||
        document.querySelector('table');
      if (!table) return [];

      // ヘッダー列名 -> index
      const headerCells = Array.from(table.querySelectorAll('thead th, thead td'));
      const headerMap = {};
      headerCells.forEach((th, i) => {
        const t = txt(th);
        if (/種別|カテゴリ/.test(t)) headerMap.type = i;
        if (/件名|要約|サマリ|タイトル/.test(t)) headerMap.title = i;
        if (/担当/.test(t)) headerMap.assignee = i;
        if (/状態|ステータス/.test(t)) headerMap.status = i;
        if (/期限|期日/.test(t)) headerMap.due = i;
        if (/キー|課題キー/.test(t)) headerMap.key = i;
      });

      const rows = Array.from(table.querySelectorAll('tbody tr'));
      const out = [];
      for (const tr of rows) {
        const cells = Array.from(tr.querySelectorAll('td'));
        if (cells.length === 0) continue;
        const titleCell = headerMap.title != null ? cells[headerMap.title] : null;
        const link =
          (titleCell && titleCell.querySelector('a')) ||
          tr.querySelector('a[href*="/view/"]');
        const href = link ? link.getAttribute('href') : '';
        const url = href ? (href.startsWith('http') ? href : spaceUrl + href) : '';
        const keyMatch = url.match(/\/view\/([A-Z0-9_]+-\d+)/i) || (href || '').match(/([A-Z0-9_]+-\d+)/i);

        const due = headerMap.due != null ? txt(cells[headerMap.due]) : '';
        // 期限日テキストを YYYY-MM-DD に正規化
        let dueDate = null;
        const dm = due.match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
        if (dm) {
          dueDate = `${dm[1]}-${String(dm[2]).padStart(2, '0')}-${String(dm[3]).padStart(2, '0')}`;
        }

        const issue = {
          projectKey,
          projectLabel,
          key: keyMatch ? keyMatch[1] : '',
          title: titleCell ? txt(titleCell) : txt(link),
          url,
          assignee: headerMap.assignee != null ? txt(cells[headerMap.assignee]) : '',
          status: headerMap.status != null ? txt(cells[headerMap.status]) : '',
          type: headerMap.type != null ? txt(cells[headerMap.type]) : '',
          dueDate,
        };
        if (issue.title || issue.url) out.push(issue);
      }
      return out;
    },
    { spaceUrl, projectKey, projectLabel }
  );
}

async function scrapeProject(page, env, projectCfg, fetchStatuses, { debug } = {}) {
  const url = buildFindUrl(env.spaceUrl, projectCfg.key, fetchStatuses);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: env.navTimeoutMs });
  await page.waitForLoadState('networkidle', { timeout: env.navTimeoutMs }).catch(() => {});

  const all = [];
  const seen = new Set();
  for (let pageNo = 0; pageNo < 30; pageNo++) {
    await page.waitForSelector('table', { timeout: env.navTimeoutMs }).catch(() => {});
    const rows = await extractRows(page, env.spaceUrl, projectCfg.key, projectCfg.label);
    let added = 0;
    for (const r of rows) {
      const id = r.key || r.url || r.title;
      if (seen.has(id)) continue;
      seen.add(id);
      all.push(r);
      added++;
    }
    if (debug) await dumpDebug(page, `find-${projectCfg.key}-p${pageNo}`);
    if (added === 0) break;

    // 次ページ
    const next = await trySelectors(page, [
      'a[rel="next"]',
      '.pager-next a',
      'a.next',
      'a:has-text("次へ")',
      'a:has-text("次の")',
    ]);
    if (!next) break;
    const before = page.url();
    await next.click().catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: env.navTimeoutMs }).catch(() => {});
    if (page.url() === before) {
      // クリックで URL が変わらない場合は終了
      const rows2 = await extractRows(page, env.spaceUrl, projectCfg.key, projectCfg.label);
      const newIds = rows2.filter((r) => !seen.has(r.key || r.url || r.title));
      if (newIds.length === 0) break;
    }
  }
  return all;
}

async function dumpDebug(page, name) {
  try {
    const dir = debugDir();
    const safe = name.replace(/[^a-z0-9_-]/gi, '_');
    await page.screenshot({ path: path.join(dir, `${safe}.png`), fullPage: true }).catch(() => {});
    const html = await page.content().catch(() => '');
    fs.writeFileSync(path.join(dir, `${safe}.html`), html);
  } catch (_) {
    /* デバッグ出力失敗は無視 */
  }
}

/**
 * Backlog から対象プロジェクトの課題を取得して正規化配列で返す。
 * @returns {Promise<Array>}
 */
async function scrapeIssues(cfg, env, { debug = false } = {}) {
  if (!env.spaceUrl || !env.loginId || !env.password) {
    throw new Error('BACKLOG_SPACE_URL / BACKLOG_LOGIN_ID / BACKLOG_PASSWORD が未設定です（.env または環境変数を確認）');
  }
  if (!env.totpSecret) {
    throw new Error('BACKLOG_TOTP_SECRET が未設定です（このスペースは2要素認証(TOTP)が有効のため必須です）');
  }
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: env.headless });
  try {
    const context = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await context.newPage();
    page.setDefaultTimeout(env.navTimeoutMs);

    await login(page, env, { debug });

    const issues = [];
    for (const projectCfg of cfg.projects || []) {
      const rows = await scrapeProject(page, env, projectCfg, cfg.fetchStatuses || [], { debug });
      issues.push(...rows);
    }
    return issues;
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { scrapeIssues, buildFindUrl, totp, STATUS_ID };
