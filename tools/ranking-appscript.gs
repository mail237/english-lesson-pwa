/**
 * Google Apps Script (Web App) for shared ranking.
 *
 * How to use:
 * 1) Create a Google Spreadsheet (any name).
 * 2) Extensions -> Apps Script, paste this file.
 * 3) Set SECRET below (optional but recommended).
 * 4) Deploy -> New deployment -> Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5) Copy the Web app URL and set it in the app:
 *    Player menu -> 共有ランキングを設定
 *    URL = Web app URL, Secret = SECRET (if set)
 *
 * Data is stored per lessonId + name (name-only identity).
 * If the same name writes again, the best (max) scores are kept.
 */

const SHEET_NAME = "ranking";
const SECRET = ""; // set shared key, e.g. "classA-2026"

function doOptions(e) {
  return jsonOut_({ ok: true });
}

function doGet(e) {
  const action = (e.parameter.action || "").trim();
  if (action === "leaderboard") {
    const lessonId = (e.parameter.lessonId || "").trim();
    const secret = (e.parameter.secret || "").trim();
    if (!allow_(secret)) return jsonOut_({ ok: false, error: "forbidden" }, 403);
    return jsonOut_({ ok: true, rows: leaderboard_(lessonId) });
  }
  return jsonOut_({ ok: false, error: "bad_request" }, 400);
}

function doPost(e) {
  let body = {};
  try {
    body = JSON.parse(e.postData && e.postData.contents ? e.postData.contents : "{}");
  } catch (err) {
    return jsonOut_({ ok: false, error: "bad_json" }, 400);
  }
  const action = String(body.action || "").trim();
  const secret = String(body.secret || "").trim();
  if (!allow_(secret)) return jsonOut_({ ok: false, error: "forbidden" }, 403);

  if (action === "upsert") {
    const lessonId = String(body.lessonId || "").trim();
    const name = String(body.name || "").trim();
    const word = Number(body.word || 0) || 0;
    const grammar = Number(body.grammar || 0) || 0;
    const total = Number(body.total || (word + grammar)) || 0;
    if (!lessonId || !name) return jsonOut_({ ok: false, error: "missing" }, 400);
    upsert_(lessonId, name, word, grammar, total);
    return jsonOut_({ ok: true });
  }
  return jsonOut_({ ok: false, error: "bad_request" }, 400);
}

// ---------- internals ----------

function allow_(secret) {
  if (!SECRET) return true; // allow when not set
  return secret && secret === SECRET;
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(["lessonId", "name", "word", "grammar", "total", "updatedAt"]);
  }
  return sh;
}

function upsert_(lessonId, name, word, grammar, total) {
  const sh = sheet_();
  const values = sh.getDataRange().getValues();
  const now = new Date();
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (String(row[0]) === lessonId && String(row[1]) === name) {
      const prevWord = Number(row[2] || 0) || 0;
      const prevGrammar = Number(row[3] || 0) || 0;
      const prevTotal = Number(row[4] || 0) || 0;
      const nextWord = Math.max(prevWord, word);
      const nextGrammar = Math.max(prevGrammar, grammar);
      const nextTotal = Math.max(prevTotal, total, nextWord + nextGrammar);
      sh.getRange(i + 1, 3, 1, 4).setValues([[nextWord, nextGrammar, nextTotal, now]]);
      return;
    }
  }
  sh.appendRow([lessonId, name, word, grammar, total, now]);
}

function leaderboard_(lessonId) {
  const sh = sheet_();
  const values = sh.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (lessonId && String(row[0]) !== lessonId) continue;
    rows.push({
      name: String(row[1] || ""),
      word: Number(row[2] || 0) || 0,
      grammar: Number(row[3] || 0) || 0,
      total: Number(row[4] || 0) || 0
    });
  }
  rows.sort((a, b) => (b.total - a.total) || (b.word - a.word) || (b.grammar - a.grammar) || a.name.localeCompare(b.name));
  return rows;
}

function jsonOut_(obj, status) {
  const out = ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
  const hdrs = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
  Object.keys(hdrs).forEach((k) => out.setHeader(k, hdrs[k]));
  if (status) out.setHeader("Status", String(status));
  return out;
}

