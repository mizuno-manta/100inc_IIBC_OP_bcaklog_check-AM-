# 定期トリガー設定手順（Claude Code on the web）

平日 9:30 / 16:00 JST に自動実行するため、Claude Code (web) で **2つのスケジュール**を作成します。
参考: https://code.claude.com/docs/en/claude-code-on-the-web

## 前提

1. このリポジトリ用の**環境（Environment）**を作成し、以下を**シークレット/環境変数**として登録する。
   - `BACKLOG_SPACE_URL` / `BACKLOG_LOGIN_ID` / `BACKLOG_PASSWORD` / `BACKLOG_TOTP_SECRET`（このスペースは2FA必須）
   - 任意: `SLACK_CHANNEL_ID`（既定 `C09CYQLNQNR`）, `SKIP_ON_HOLIDAY`
2. その環境で **Slack MCP** が利用可能（`#sol-prj-iibc-op` へ投稿できる）こと。
3. **ネットワークポリシー**が Backlog ドメイン（`*.backlog.com` / `*.backlog.jp`）と Slack への
   アウトバウンドを許可していること（スクレイピングに必須）。

## スケジュール 1：朝アラート

- **スケジュール**: 平日 9:30 JST
  - JST 指定が可能な場合: `30 9 * * 1-5`
  - UTC 指定の場合（JST−9h）: `30 0 * * 1-5`
- **プロンプト**:
  ```
  IIBC Backlog の朝の期日アラート（morning）を実行してください。CLAUDE.md の手順に従い、
  node src/run.js morning を実行し、out/payload.json の text を Slack MCP で
  そのまま #sol-prj-iibc-op（C09CYQLNQNR）へ投稿してください。
  ```

## スケジュール 2：夕方チェック

- **スケジュール**: 平日 16:00 JST
  - JST 指定が可能な場合: `0 16 * * 1-5`
  - UTC 指定の場合: `0 7 * * 1-5`
- **プロンプト**:
  ```
  IIBC Backlog の夕方の残タスクチェック（evening）を実行してください。CLAUDE.md の手順に従い、
  node src/run.js evening を実行し、out/payload.json の text を Slack MCP で
  そのまま #sol-prj-iibc-op（C09CYQLNQNR）へ投稿してください。
  ```

## 動作確認

1. まず各スケジュールを**手動実行**して、Slack に正しい文面が届くか確認する。
2. スクレイピングが空/不一致の場合は、セッションで `node src/run.js morning --debug` を実行し、
   `debug/` の HTML/スクショを見て `src/backlog.js` のセレクタを調整する（README 参照）。
3. 祝日に通知を止めたい場合は環境変数 `SKIP_ON_HOLIDAY=true` を設定。

## 注意

- トリガー時刻は実行環境（コンテナ起動・依存導入・スクレイピング）に数分の遅延が出る場合があります。
  厳密な時刻が必要なら数分前倒しのスケジュールを検討してください。
- リトライ設定がある場合、二重送信に注意（現状、重複送信防止は未実装）。
