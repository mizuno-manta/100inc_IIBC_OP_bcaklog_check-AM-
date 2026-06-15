'use strict';

// 日付計算を JST 基準にするため、何よりも先に TZ を固定する。
process.env.TZ = 'Asia/Tokyo';

const fs = require('fs');
const path = require('path');

const { loadConfig, loadEnv } = require('./config');
const dates = require('./dates');
const { selectByDueDate } = require('./filters');
const { buildMorningMessage, buildEveningMessage } = require('./format');

function parseArgs(argv) {
  const args = { mode: null, dryRun: false, debug: false, fixture: null };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === 'morning' || a === 'evening') args.mode = a;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--debug') args.debug = true;
    else if (a === '--from-fixture') args.fixture = rest[++i];
  }
  return args;
}

async function getIssues(cfg, env, args) {
  if (args.fixture) {
    const raw = fs.readFileSync(args.fixture, 'utf8');
    return JSON.parse(raw);
  }
  const { scrapeIssues } = require('./backlog');
  return scrapeIssues(cfg, env, { debug: args.debug });
}

function writePayload(payload) {
  const outDir = path.join(process.cwd(), 'out');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'payload.json');
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.mode) {
    console.error('Usage: node src/run.js <morning|evening> [--dry-run] [--debug] [--from-fixture <path>]');
    process.exit(2);
  }

  const cfg = loadConfig();
  const env = loadEnv();

  const todayDate = dates.today();

  // 平日に当たる祝日のスキップ（任意）
  if (env.skipOnHoliday && dates.isHoliday(todayDate)) {
    const payload = {
      mode: args.mode,
      channel: cfg.slackChannelId,
      skipped: true,
      reason: `本日(${dates.ymd(todayDate)})は祝日(${dates.holidayName(todayDate)})のためスキップ`,
      text: '',
    };
    writePayload(payload);
    console.log(`[skip] ${payload.reason}`);
    return;
  }

  const issues = await getIssues(cfg, env, args);
  const b = cfg.behavior || {};

  let text;
  let summary;

  if (args.mode === 'morning') {
    const nextDate = dates.nextBusinessDay(todayDate);
    const todayIssues = selectByDueDate(issues, todayDate, {
      memberFilter: b.memberFilterTodayMorning !== false,
      cfg,
    });
    const nextIssues = selectByDueDate(issues, nextDate, {
      memberFilter: b.memberFilterNextBusinessDay === true,
      cfg,
    });
    text = buildMorningMessage({ todayIssues, nextIssues, todayDate, nextDate, cfg });
    summary = {
      todayCount: todayIssues.length,
      nextBusinessDay: dates.ymd(nextDate),
      nextCount: nextIssues.length,
    };
    if (todayIssues.length === 0 && nextIssues.length === 0 && b.sendMorningWhenEmpty === false) {
      summary.skipped = true;
    }
  } else {
    const remainingIssues = selectByDueDate(issues, todayDate, {
      memberFilter: b.memberFilterEvening !== false,
      cfg,
    });
    text = buildEveningMessage({ remainingIssues, todayDate, cfg });
    summary = { remainingCount: remainingIssues.length };
  }

  const payload = {
    mode: args.mode,
    channel: cfg.slackChannelId,
    date: dates.ymd(todayDate),
    summary,
    fetchedIssueCount: issues.length,
    text,
  };

  const file = writePayload(payload);

  // 人間/エージェント向けの出力
  console.log('===== SUMMARY =====');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\n===== SLACK PAYLOAD (channel=${payload.channel}) =====`);
  console.log(text);
  console.log(`\n[payload written] ${file}`);

  if (args.dryRun) {
    console.log('\n[dry-run] 送信は行いません。');
  }
}

main().catch((err) => {
  console.error('[error]', err && err.stack ? err.stack : err);
  process.exit(1);
});
