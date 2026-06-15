'use strict';

const { slashDate, weekdayJa, isSameDay, addDays } = require('./dates');
const { groupByProject } = require('./filters');

/** メンション行（5 名）。未設定なら空文字。 */
function mentionLine(cfg) {
  const ids = cfg.mentionUserIds || [];
  if (ids.length === 0) return '';
  return ids.map((id) => `<@${id}>`).join(' ');
}

/** 1 課題分のブロック */
function renderIssue(issue) {
  const lines = [
    `📌 ${issue.title || '(無題)'}`,
    `🔗 ${issue.url || ''}`,
    `👤 担当者：${issue.assignee || '未設定'}`,
    `📅 期限日：${issue.dueDate ? slashDate(parseLoose(issue.dueDate)) : '未設定'}`,
    `📊 ステータス：${issue.status || '不明'}`,
    `🏷 種別：${issue.type || '未設定'}`,
  ];
  return lines.join('\n');
}

// dueDate は 'YYYY-MM-DD' 想定。表示用に Date 化。
function parseLoose(str) {
  const m = String(str).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return new Date(NaN);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** プロジェクトごとにグルーピングして課題群を描画 */
function renderGroups(issues, cfg) {
  const groups = groupByProject(issues, cfg);
  const parts = [];
  for (const g of groups) {
    parts.push(`【 ${g.label} 】`);
    parts.push(g.issues.map(renderIssue).join('\n\n'));
  }
  return parts.join('\n');
}

/**
 * 朝アラート（9:30）。
 * todayIssues: 本日期日（100inc メンバー担当）
 * nextIssues:  翌営業日期日（全担当者）
 */
function buildMorningMessage({ todayIssues, nextIssues, todayDate, nextDate, cfg }) {
  const out = [];
  out.push('🔔 IIBC Backlog 期日アラート');
  const ment = mentionLine(cfg);
  if (ment) out.push(ment);
  out.push('');

  // ⚡ 本日期日
  out.push(`⚡ 【本日期日・100incメンバー担当】 ${todayIssues.length} 件`);
  if (todayIssues.length > 0) {
    out.push(renderGroups(todayIssues, cfg));
  } else {
    out.push('（該当なし）');
  }
  out.push('');

  // 🚨 翌営業日期日（明日 or 曜日名）
  const tomorrow = addDays(todayDate, 1);
  const nextLabel = isSameDay(nextDate, tomorrow)
    ? `明日・${weekdayJa(nextDate)}`
    : `翌営業日・${weekdayJa(nextDate)}`;
  out.push(`🚨 【${nextLabel}（${ymdDash(nextDate)}）期日・処理済み以外】 ${nextIssues.length} 件`);
  if (nextIssues.length > 0) {
    out.push(renderGroups(nextIssues, cfg));
  } else {
    out.push('（該当なし）');
  }

  return out.join('\n').trimEnd() + '\n';
}

/**
 * 夕方チェック（16:00）。本日期日かつ未処理の残タスク。
 */
function buildEveningMessage({ remainingIssues, todayDate, cfg }) {
  const out = [];
  const ment = mentionLine(cfg);

  if (remainingIssues.length > 0) {
    out.push('🚨 IIBC Backlog 夕方残タスクチェック');
    if (ment) out.push(ment);
    out.push('');
    out.push(`本日（${ymdDash(todayDate)}）期日の未処理タスクが ${remainingIssues.length} 件 残っています。至急対応してください。`);
    out.push('');
    out.push(renderGroups(remainingIssues, cfg));
  } else {
    out.push('✅ IIBC Backlog 夕方残タスクチェック');
    out.push('');
    out.push(`本日（${ymdDash(todayDate)}）期日の残タスクはありません。お疲れさまでした。`);
  }
  return out.join('\n').trimEnd() + '\n';
}

function ymdDash(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

module.exports = {
  mentionLine,
  renderIssue,
  renderGroups,
  buildMorningMessage,
  buildEveningMessage,
};
