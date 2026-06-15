# IIBC Backlog 期日アラート

Backlog の課題をスクレイピングし、期日に応じて Slack（#sol-prj-iibc-op）へ通知するジョブです。
別環境（他AIエージェント）で運用していたものを **Claude Code (web) の定期トリガー**へ移設したものです。

## 何をするか

| ジョブ | スケジュール | モード | 内容 |
| --- | --- | --- | --- |
| 朝アラート | 平日 9:30 JST | `morning` | ⚡本日期日（100incメンバー担当）＋🚨翌営業日期日（全担当者）を1通で通知 |
| 夕方チェック | 平日 16:00 JST | `evening` | 本日期日かつ未処理の残タスクを確認。残あり→🚨／残なし→✅ |

- **対象プロジェクト / 種別 / ステータス**は `config/config.json` で設定（コード変更不要）。
  - `HUBS_CMS_TASK`: 種別 `Eメール配信 / メール運用代行 / ページ運用` のみ対象
  - `100_REQUESTS`: 種別 `プロジェクト運用` 以外すべて対象
  - ステータス: `未対応 / 処理中 / 処理済み` を取得し、`処理済み / 完了` は通知から除外
- **祝日考慮**: `japanese-holidays`（振替休日含む）で翌営業日を算出。金曜→月曜・祝日跨ぎ対応。

## アーキテクチャ（移設後）

```
Claude Code (web) 定期トリガー（平日 9:30 / 16:00 JST）
   └─ セッション起動
        ├─ SessionStart フック (.claude/setup.sh) で依存を整備
        ├─ エージェントが CLAUDE.md に従い `node src/run.js <morning|evening>` を実行
        │     └─ Playwright で Backlog ログイン→課題スクレイピング→期日計算→文面整形
        │     └─ out/payload.json に {channel, text, summary} を出力
        └─ エージェントが out/payload.json の text を Slack MCP でそのまま投稿
```

- **決定論的処理**（スクレイピング・判定・整形）= Node スクリプト
- **送信** = Claude の Slack MCP（トークン管理不要）

## 実行環境の制約（重要）

Claude Code (web) の実行環境には以下の制約があり、設計に反映済みです。

- **ブラウザのダウンロード元 `cdn.playwright.dev` は egress 許可外（403）**。新規ブラウザを取得できません。
  - 対策: `/opt/pw-browsers` に**プリインストール済みの Chromium（revision 1194）**があるため、
    `package.json` の `playwright` を**そのブラウザに一致する `1.56.1` に固定**しています。
  - ⚠ `playwright` を 1.56.1 から上げると別 revision のブラウザを要求してダウンロードに失敗します。
    上げる場合は egress 許可リストに `cdn.playwright.dev` を追加するか、対応ブラウザを別途配置してください。
- **Backlog / Slack へのアウトバウンドは egress 許可が必要**。環境のネットワークポリシーで
  `*.backlog.com`（または `*.backlog.jp`）への接続を許可してください。許可されていないと
  スクレイピングが失敗します（`debug/` に失敗時の HTML/スクショが残ります）。
- ブラウザ検出は SessionStart フック（`.claude/setup.sh`）で確認します。プリインストール版が
  見つかればダウンロードは行いません。

## ディレクトリ構成

```
src/
  run.js        エントリ（morning|evening）
  backlog.js    Playwright スクレイピング
  filters.js    プロジェクト/種別/ステータス/担当者フィルタ
  dates.js      JST 日付・祝日・翌営業日計算
  format.js     Slack 文面整形
  config.js     設定/環境変数ロード
config/config.json   判定設定（種別・メンバー・メンション 等）
test/                ユニットテスト + フィクスチャ
docs/schedule-setup.md  定期トリガー設定手順
CLAUDE.md            定期セッションでエージェントが行う手順
```

## セットアップ

### 1. 必要なシークレット / 環境変数

`.env.example` を参照。本番（Claude Code web）では **環境のシークレット/環境変数**として登録してください（`.env` をコミットしない）。

| 変数 | 必須 | 内容 |
| --- | --- | --- |
| `BACKLOG_SPACE_URL` | ✅ | 例 `https://your-space.backlog.com`（`.jp` の場合あり） |
| `BACKLOG_LOGIN_ID` | ✅ | Backlog ログインID/メール |
| `BACKLOG_PASSWORD` | ✅ | パスワード |
| `BACKLOG_TOTP_SECRET` | ✅ | TOTP の Base32 シークレット（このスペースは2要素認証が必須） |
| `SLACK_CHANNEL_ID` | – | 既定 `C09CYQLNQNR`（#sol-prj-iibc-op） |
| `SKIP_ON_HOLIDAY` | – | `true` で祝日（平日に当たる場合）は通知スキップ |
| `HEADLESS` | – | 既定 `true` |

> ⚠ Slack 送信は Claude の Slack MCP が行うため、**Slack トークンは不要**です。

### 2. config/config.json

- `mentionUserIds`: 冒頭でメンションする **5名の Slack ユーザーID**（`U...`）。未設定だとメンションなし。
- `incMemberNames`: 担当者を 100inc メンバーに絞るための名前リスト（表記ゆれ含む）。
- `projects[].typeFilter`: 種別の allow/deny。
- `behavior`: 各セクションのメンバー絞り込み ON/OFF 等。

### 3. ローカル実行・確認

```bash
npm install
npx playwright install chromium

# 実データなしで整形ロジックを確認（フィクスチャ + 送信なし）
node src/run.js morning --from-fixture test/fixtures/issues.sample.json --dry-run
node src/run.js evening --from-fixture test/fixtures/issues.sample.json --dry-run

# 実 Backlog に対して取得（要シークレット）。--debug で debug/ に HTML/スクショ保存
node src/run.js morning --debug

# ユニットテスト
npm test
```

`out/payload.json` に Slack 送信用ペイロードが書き出されます。`--dry-run` でも送信はされません
（このリポジトリのスクリプトは Slack へ直接送信しません。送信はセッション内のエージェントが MCP で行います）。

## 定期実行（トリガー）の設定

`docs/schedule-setup.md` を参照。Claude Code (web) で平日 9:30 / 16:00 JST の2つのトリガーを作成します。

## スクレイピングの最終調整

`src/backlog.js` は Backlog の標準DOMを前提にした**列ヘッダー名ベース**の汎用実装です。
実スペースのDOM差異により最初の取得が空/不一致になる場合があります。その際は:

```bash
node src/run.js morning --debug
```

で `debug/*.html` `debug/*.png` を確認し、`src/backlog.js` の以下を実スペースに合わせて調整してください。
- ログインフォームのセレクタ（`login()` 内）
- `/find/{KEY}` の検索URL・ステータスID（`buildFindUrl()` / `STATUS_ID`）
- 結果テーブルのヘッダー名マッピング（`extractRows()` 内の正規表現）

## 注意

- 文面はスクリプトが生成した `text` をそのまま送信します（エージェントは改変しません）。
- 認証情報はログ/Slack に出力しません。
- 二重起動による二重送信防止は未実装（トリガー再試行に注意）。
