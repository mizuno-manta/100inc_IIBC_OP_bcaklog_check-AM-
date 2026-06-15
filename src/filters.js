'use strict';

const { parseYMD, ymd } = require('./dates');

/** 名前比較用に空白を除去（"桑野 彩花" と "桑野彩花" を同一視） */
function normalizeName(s) {
  return String(s || '').replace(/[\s　]+/g, '').trim();
}

/** 担当者が 100inc メンバーか */
function isIncMember(assignee, cfg) {
  if (!assignee) return false;
  const set = new Set((cfg.incMemberNames || []).map(normalizeName));
  return set.has(normalizeName(assignee));
}

/** ステータスが通知対象か（除外リストに含まれないか） */
function isNotifiableStatus(issue, cfg) {
  const excl = new Set(cfg.excludeStatuses || []);
  return !excl.has(String(issue.status || '').trim());
}

/** プロジェクトごとの種別フィルタを通過するか */
function passesTypeFilter(issue, projectCfg) {
  const tf = projectCfg && projectCfg.typeFilter;
  if (!tf || !tf.types || tf.types.length === 0) return true;
  const type = String(issue.type || '').trim();
  const list = tf.types.map((t) => String(t).trim());
  const matched = list.includes(type);
  if (tf.mode === 'deny') return !matched; // 指定種別を除外
  return matched; // allow: 指定種別のみ
}

/** projectKey から projects 設定を引く */
function projectCfgOf(issue, cfg) {
  return (cfg.projects || []).find((p) => p.key === issue.projectKey) || null;
}

/**
 * 通知候補の母集団フィルタ:
 *  - 対象プロジェクトに属する
 *  - 種別フィルタを通過
 *  - 通知対象ステータス（除外ステータスでない）
 */
function baseFilter(issues, cfg) {
  return issues.filter((issue) => {
    const pc = projectCfgOf(issue, cfg);
    if (!pc) return false;
    if (!passesTypeFilter(issue, pc)) return false;
    if (!isNotifiableStatus(issue, cfg)) return false;
    return true;
  });
}

/**
 * 指定の期限日（Date）に一致する課題を抽出。
 * memberFilter=true の場合は 100inc メンバー担当のみ。
 */
function selectByDueDate(issues, dueDate, { memberFilter, cfg }) {
  const target = ymd(dueDate);
  return baseFilter(issues, cfg).filter((issue) => {
    const due = parseYMD(issue.dueDate);
    if (!due || ymd(due) !== target) return false;
    if (memberFilter && !isIncMember(issue.assignee, cfg)) return false;
    return true;
  });
}

/** プロジェクト単位でグルーピング（config の projects 順を保持） */
function groupByProject(issues, cfg) {
  const order = (cfg.projects || []).map((p) => p.key);
  const groups = new Map();
  for (const key of order) groups.set(key, []);
  for (const issue of issues) {
    if (!groups.has(issue.projectKey)) groups.set(issue.projectKey, []);
    groups.get(issue.projectKey).push(issue);
  }
  // 空グループは除外
  const result = [];
  for (const [key, list] of groups) {
    if (list.length > 0) {
      const pc = (cfg.projects || []).find((p) => p.key === key);
      result.push({ key, label: (pc && pc.label) || key, issues: list });
    }
  }
  return result;
}

module.exports = {
  normalizeName,
  isIncMember,
  isNotifiableStatus,
  passesTypeFilter,
  baseFilter,
  selectByDueDate,
  groupByProject,
};
