// データソースは日本時間（JST）基準で日付が切り替わるため、常に JST で「今日」を計算する。
function todayJst() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function isValidDate(dateStr) {
  return /^\d{8}$/.test(dateStr);
}

function splitDate(dateStr) {
  return { year: dateStr.slice(0, 4), full: dateStr };
}

module.exports = { todayJst, isValidDate, splitDate };
