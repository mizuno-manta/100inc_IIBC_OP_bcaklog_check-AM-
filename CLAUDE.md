# IIBC Backlog 期日アラート — 実行手順（定期セッション用）

このリポジトリは **Backlog の課題をスクレイピングして Slack に期日アラートを通知する**ジョブです。
Claude Code (web) の**定期トリガー**で起動され、各セッションであなた（エージェント）が以下を実行します。

決定論的な処理（ログイン・スクレイピング・期日計算・文面整形）はすべて Node スクリプトが行います。
**あなたの役割は「スクリプトを実行し、その出力を Slack MCP でそのまま投稿する」ことだけ**です。
文面を要約・改変しないでください。

---

## モードの判定

トリガーのプロンプト文言からモードを判定します。

| プロンプトに含まれる語 | モード | 実行コマンド |
| --- | --- | --- |
| 「朝」「morning」「9:30」「期日アラート」 | morning | `node src/run.js morning` |
| 「夕方」「evening」「16:00」「残タスク」 | evening | `node src/run.js evening` |

判別できない場合は `morning` を既定とします。

---

## 実行手順

1. **スクリプトを実行**する（例: 朝なら `node src/run.js morning`）。
   - 依存が無ければ SessionStart フックが導入済みのはずですが、`Cannot find module` 等で失敗したら
     `npm install` と `npx playwright install chromium` を実行してから再試行してください。
2. 実行後、**`out/payload.json`** を読む。形式:
   ```json
   {
     "mode": "morning",
     "channel": "C09CYQLNQNR",
     "summary": { ... },
     "text": "🔔 IIBC Backlog 期日アラート\n...",
     "skipped": false
   }
   ```
3. `skipped: true` の場合（祝日スキップなど）は **何も送信せず終了**し、`reason` を1行報告する。
4. それ以外は **Slack MCP の `slack_send_message`** で送信する。
   - `channel_id`: payload の `channel`（既定 `C09CYQLNQNR` = #sol-prj-iibc-op）
   - `text`: payload の `text` を**そのまま**（改変・要約・絵文字削除をしない）
   - `text` 内の `<@Uxxxx>` はメンションとして送る（エスケープしない）。
5. 送信後、件数サマリ（`summary`）を1〜2行で報告して終了。

---

## スクリプトが失敗した場合

スクレイピングはログイン・DOM 変更で失敗し得ます。`node src/run.js ...` がエラー終了したら:

1. まず1回だけ再実行する。
2. それでも失敗する場合は、**チームが「アラートが動かなかった」と気づけるよう**、
   Slack MCP で `#sol-prj-iibc-op` に次の短い通知を送る:
   ```
   ⚠️ IIBC Backlog 期日アラート（<morning|evening>）の自動実行に失敗しました。
   エラー: <エラーメッセージの先頭1〜2行>
   手動確認をお願いします。
   ```
3. `debug/` にスクリーンショット/HTML があれば、原因（ログイン失敗/セレクタ不一致など）を1行報告する。

---

## 重要な注意

- 文面の**改変禁止**。スクリプト出力 `text` をそのまま投稿する。
- 送信先は**必ず** payload の `channel`。他チャンネルへ送らない。
- 認証情報（Backlog ログイン等）は環境変数で渡されます。ログや Slack に出力しないこと。
- 設定変更（対象種別・メンバー・メンション等）は `config/config.json` を編集します（コード変更不要）。
