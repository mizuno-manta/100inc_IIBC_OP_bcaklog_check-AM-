#!/usr/bin/env bash
# SessionStart フック: 定期トリガー/対話セッション開始時に実行環境を整える。
# 冪等・高速・非致命（失敗してもセッションは継続）。
set -u

cd "$(dirname "$0")/.." || exit 0

# 1) Node 依存
if [ ! -d node_modules ] || [ ! -d node_modules/playwright ]; then
  echo "[setup] installing node dependencies..."
  npm install --no-audit --no-fund >/tmp/iibc_npm_install.log 2>&1 || \
    echo "[setup] npm install で問題が発生しました（/tmp/iibc_npm_install.log を参照）"
fi

# 2) Playwright Chromium
#    この環境には chromium が /opt/pw-browsers にプリインストール済みで、
#    package.json の playwright を実環境に合わせてピン留めしているため
#    通常はダウンロード不要。executablePath のファイルが無い場合のみ導入を試みる
#    （ただし cdn.playwright.dev が egress 許可されていないと失敗する点に注意）。
CHROME_PATH=$(node -e "try{process.stdout.write(require('playwright').chromium.executablePath())}catch(e){process.exit(1)}" 2>/dev/null)
if [ -z "${CHROME_PATH}" ] || [ ! -f "${CHROME_PATH}" ]; then
  echo "[setup] Chromium が見つかりません。導入を試みます（cdn.playwright.dev の egress 許可が必要）..."
  npx playwright install chromium >/tmp/iibc_pw_install.log 2>&1 || \
    echo "[setup] Chromium の導入に失敗しました。playwright のバージョンをプリインストール版に合わせるか、egress 許可リストに cdn.playwright.dev を追加してください（/tmp/iibc_pw_install.log）"
else
  echo "[setup] Chromium OK: ${CHROME_PATH}"
fi

echo "[setup] ready."
exit 0
