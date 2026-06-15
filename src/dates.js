'use strict';

// すべての日付計算を日本時間(JST)基準で行うため、最初に TZ を固定する。
// （run.js / テストランナーの先頭でも設定しているが、念のためここでも固定）
if (process.env.TZ !== 'Asia/Tokyo') {
  process.env.TZ = 'Asia/Tokyo';
}

const jpHolidays = require('japanese-holidays');

const WEEKDAY_JA = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];

/** Date -> 'YYYY-MM-DD'（ローカル=JST） */
function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Date -> 'YYYY/MM/DD' */
function slashDate(date) {
  return ymd(date).replace(/-/g, '/');
}

/** 'YYYY-MM-DD' / 'YYYY/MM/DD' -> Date（ローカル深夜0時）。不正なら null。 */
function parseYMD(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) {
    return null;
  }
  return date;
}

/** 本日（JST 深夜0時） */
function today() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isWeekend(date) {
  const w = date.getDay();
  return w === 0 || w === 6;
}

/** 国民の祝日（振替休日含む）か。japanese-holidays は祝日名 or undefined を返す。 */
function isHoliday(date) {
  return Boolean(jpHolidays.isHoliday(date));
}

function holidayName(date) {
  return jpHolidays.isHoliday(date) || null;
}

/** 翌営業日（週末・祝日をスキップ）。金曜→月曜、祝日跨ぎに対応。 */
function nextBusinessDay(date) {
  let d = addDays(date, 1);
  while (isWeekend(d) || isHoliday(d)) {
    d = addDays(d, 1);
  }
  return d;
}

function weekdayJa(date) {
  return WEEKDAY_JA[date.getDay()];
}

/** 2 つの Date が同一カレンダー日付か */
function isSameDay(a, b) {
  return ymd(a) === ymd(b);
}

module.exports = {
  ymd,
  slashDate,
  parseYMD,
  today,
  addDays,
  isWeekend,
  isHoliday,
  holidayName,
  nextBusinessDay,
  weekdayJa,
  isSameDay,
};
