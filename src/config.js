'use strict';

const fs = require('fs');
const path = require('path');

try {
  // .env があれば読み込む（本番はプロセス環境変数を使用）
  require('dotenv').config();
} catch (_) {
  /* dotenv 未インストールでも環境変数だけで動作可能 */
}

function loadConfig() {
  const configPath = path.join(__dirname, '..', 'config', 'config.json');
  const raw = fs.readFileSync(configPath, 'utf8');
  const cfg = JSON.parse(raw);

  // 環境変数による上書き
  if (process.env.SLACK_CHANNEL_ID) cfg.slackChannelId = process.env.SLACK_CHANNEL_ID;
  if (process.env.BACKLOG_PROJECT_KEYS) {
    const keys = process.env.BACKLOG_PROJECT_KEYS.split(',').map((s) => s.trim()).filter(Boolean);
    if (keys.length) {
      // 既存の projects 設定から該当キーのみを残す（順序は env に従う）
      const byKey = new Map((cfg.projects || []).map((p) => [p.key, p]));
      cfg.projects = keys.map((k) => byKey.get(k) || { key: k, label: k, typeFilter: { mode: 'allow', types: [] } });
    }
  }
  return cfg;
}

function loadEnv() {
  return {
    spaceUrl: (process.env.BACKLOG_SPACE_URL || '').replace(/\/+$/, ''),
    loginId: process.env.BACKLOG_LOGIN_ID || '',
    password: process.env.BACKLOG_PASSWORD || '',
    totpSecret: process.env.BACKLOG_TOTP_SECRET || '',
    headless: String(process.env.HEADLESS || 'true').toLowerCase() !== 'false',
    navTimeoutMs: Number(process.env.NAV_TIMEOUT_MS || 45000),
    skipOnHoliday: String(process.env.SKIP_ON_HOLIDAY || 'false').toLowerCase() === 'true',
  };
}

module.exports = { loadConfig, loadEnv };
