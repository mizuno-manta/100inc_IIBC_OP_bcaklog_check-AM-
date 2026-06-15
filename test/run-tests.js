'use strict';

process.env.TZ = 'Asia/Tokyo';

const fs = require('fs');
const path = require('path');

const dates = require('../src/dates');
const { selectByDueDate, isIncMember, passesTypeFilter } = require('../src/filters');
const { buildMorningMessage, buildEveningMessage } = require('../src/format');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}
function eq(actual, expected, msg) {
  assert(actual === expected, `${msg} (expected=${JSON.stringify(expected)}, actual=${JSON.stringify(actual)})`);
}

const cfg = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config', 'config.json'), 'utf8')
);
// テスト用にメンションを固定
cfg.mentionUserIds = ['U111', 'U222', 'U333', 'U444', 'U555'];

const issues = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'issues.sample.json'), 'utf8')
);

console.log('— dates —');
{
  // 金曜 → 月曜
  const fri = new Date(2026, 5, 19); // 2026-06-19 (Fri)
  eq(dates.weekdayJa(fri), '金曜日', 'weekdayJa(2026-06-19)=金曜日');
  eq(dates.ymd(dates.nextBusinessDay(fri)), '2026-06-22', 'nextBusinessDay(Fri 6/19)=Mon 6/22');

  // 祝日跨ぎ: 2026-07-20 は海の日(月)。金 7/17 → 火 7/21
  const fri2 = new Date(2026, 6, 17); // 2026-07-17 (Fri)
  eq(dates.isHoliday(new Date(2026, 6, 20)), true, '2026-07-20 は祝日(海の日)');
  eq(dates.ymd(dates.nextBusinessDay(fri2)), '2026-07-21', 'nextBusinessDay(Fri 7/17)=Tue 7/21 (海の日跨ぎ)');

  // 平日 → 翌日
  const mon = new Date(2026, 5, 15); // 2026-06-15 (Mon)
  eq(dates.ymd(dates.nextBusinessDay(mon)), '2026-06-16', 'nextBusinessDay(Mon 6/15)=Tue 6/16');

  eq(dates.slashDate(new Date(2026, 5, 15)), '2026/06/15', 'slashDate');
  eq(dates.ymd(dates.parseYMD('2026/06/15')), '2026-06-15', 'parseYMD slash');
  eq(dates.parseYMD('invalid'), null, 'parseYMD invalid -> null');
}

console.log('— filters —');
{
  eq(isIncMember('桑野彩花', cfg), true, 'isIncMember 空白なし一致');
  eq(isIncMember('桑野 彩花', cfg), true, 'isIncMember 空白あり一致');
  eq(isIncMember('外部 太郎', cfg), false, 'isIncMember 非メンバー');

  const hubs = cfg.projects.find((p) => p.key === 'HUBS_CMS_TASK');
  const req = cfg.projects.find((p) => p.key === '100_REQUESTS');
  eq(passesTypeFilter({ type: 'メール運用代行' }, hubs), true, 'HUBS allow: メール運用代行');
  eq(passesTypeFilter({ type: 'ページ作成' }, hubs), false, 'HUBS allow外: ページ作成');
  eq(passesTypeFilter({ type: 'プロジェクト運用' }, req), false, '100_REQUESTS deny: プロジェクト運用');
  eq(passesTypeFilter({ type: '運用代行' }, req), true, '100_REQUESTS deny外: 運用代行');

  // 本日(2026-06-15) memberFilter ON
  const today = new Date(2026, 5, 15);
  const todaySel = selectByDueDate(issues, today, { memberFilter: true, cfg });
  eq(todaySel.length, 2, '本日期日(メンバー)=2件 (101,201)');
  const keys = todaySel.map((i) => i.key).sort();
  eq(keys.join(','), '100_REQUESTS-101,HUBS_CMS_TASK-201', '本日期日の課題キー');

  // 翌営業日(2026-06-16) memberFilter OFF
  const next = new Date(2026, 5, 16);
  const nextSel = selectByDueDate(issues, next, { memberFilter: false, cfg });
  eq(nextSel.length, 2, '翌営業日(全担当者)=2件 (103,105)');

  // 翌営業日 memberFilter ON だと外部担当者は除外され1件
  const nextMember = selectByDueDate(issues, next, { memberFilter: true, cfg });
  eq(nextMember.length, 1, '翌営業日(メンバー限定)=1件 (105)');
}

console.log('— format —');
{
  const today = new Date(2026, 5, 15);
  const next = new Date(2026, 5, 16);
  const todayIssues = selectByDueDate(issues, today, { memberFilter: true, cfg });
  const nextIssues = selectByDueDate(issues, next, { memberFilter: false, cfg });
  const msg = buildMorningMessage({ todayIssues, nextIssues, todayDate: today, nextDate: next, cfg });

  assert(msg.includes('🔔 IIBC Backlog 期日アラート'), 'morning タイトル');
  assert(msg.includes('<@U111> <@U222> <@U333> <@U444> <@U555>'), 'morning メンション5名');
  assert(msg.includes('⚡ 【本日期日・100incメンバー担当】 2 件'), 'morning 本日件数');
  assert(msg.includes('明日・火曜日（2026-06-16）期日・処理済み以外】 2 件'), 'morning 翌営業日ヘッダー');
  assert(msg.includes('【 100_REQUESTS 】'), 'morning プロジェクト見出し');
  assert(msg.includes('📅 期限日：2026/06/15'), 'morning 期限日表示');
  assert(!msg.includes('プロジェクト運用タスク'), 'morning 除外種別が含まれない');

  // 夕方: 残あり
  const evMsg = buildEveningMessage({ remainingIssues: todayIssues, todayDate: today, cfg });
  assert(evMsg.includes('🚨'), 'evening 残あり 🚨');
  assert(evMsg.includes('至急対応してください'), 'evening 至急文言');

  // 夕方: 残なし
  const evEmpty = buildEveningMessage({ remainingIssues: [], todayDate: today, cfg });
  assert(evEmpty.includes('✅'), 'evening 残なし ✅');
  assert(evEmpty.includes('残タスクはありません'), 'evening 残なし文言');
}

console.log(`\n結果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
