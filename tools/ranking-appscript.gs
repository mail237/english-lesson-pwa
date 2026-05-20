/**
 * 共有ランキング（Google スプレッドシート + Apps Script）
 *
 * 【セットアップ】
 * 1) Google スプレッドシートを新規作成
 * 2) 拡張機能 → Apps Script → このファイルを コード.gs にすべて貼り付け
 * 3) 下の SPREADSHEET_ID …
 *    - スプレッドシートから開いた場合は 空のままでOK
 *    - 「無題のプロジェクト」だけの場合は ID を入れる（URLの /d/XXXX/ の XXXX）
 * 4) デプロイ → 新しいデプロイ → ウェブアプリ
 *    - 実行ユーザー: 自分 / アクセス: 全員
 * 5) Webアプリ URL を english-lesson-pwa の data/ranking-config.json に入れる
 *    （Vercel 版は起動時に自動設定）
 */

const SHEET_NAME = "ranking";
const SECRET = ""; // 任意。設定したらアプリ側の secret も同じにする
/** スタンドアロン Apps Script のときだけスプレッドシート ID を入れる */
const SPREADSHEET_ID = "";

function doOptions(e) {
  return jsonOut_({ ok: true }, e);
}

function doGet(e) {
  const action = (e.parameter.action || "").trim();
  const secret = (e.parameter.secret || "").trim();
  if (!allow_(secret)) return jsonOut_({ ok: false, error: "forbidden" }, e);

  if (action === "leaderboard") {
    const lessonId = (e.parameter.lessonId || "").trim();
    return jsonOut_({ ok: true, rows: leaderboard_(lessonId) }, e);
  }

  if (action === "upsert") {
    const lessonId = String(e.parameter.lessonId || "").trim();
    const name = String(e.parameter.name || "").trim();
    const word = Number(e.parameter.word || 0) || 0;
    const grammar = Number(e.parameter.grammar || 0) || 0;
    const total = Number(e.parameter.total || word + grammar) || 0;
    if (!lessonId || !name) return jsonOut_({ ok: false, error: "missing" }, e);
    upsert_(lessonId, name, word, grammar, total);
    return jsonOut_({ ok: true }, e);
  }

  return jsonOut_({ ok: false, error: "bad_request" }, e);
}

function doPost(e) {
  let body = {};
  try {
    body = JSON.parse(e.postData && e.postData.contents ? e.postData.contents : "{}");
  } catch (err) {
    return jsonOut_({ ok: false, error: "bad_json" }, e);
  }
  const action = String(body.action || "").trim();
  const secret = String(body.secret || "").trim();
  if (!allow_(secret)) return jsonOut_({ ok: false, error: "forbidden" }, e);

  if (action === "upsert") {
    const lessonId = String(body.lessonId || "").trim();
    const name = String(body.name || "").trim();
    const word = Number(body.word || 0) || 0;
    const grammar = Number(body.grammar || 0) || 0;
    const total = Number(body.total || word + grammar) || 0;
    if (!lessonId || !name) return jsonOut_({ ok: false, error: "missing" }, e);
    upsert_(lessonId, name, word, grammar, total);
    return jsonOut_({ ok: true }, e);
  }
  return jsonOut_({ ok: false, error: "bad_request" }, e);
}

// ---------- internals ----------

function allow_(secret) {
  if (!SECRET) return true;
  return secret && secret === SECRET;
}

function spreadsheet_() {
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_() {
  const ss = spreadsheet_();
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
  rows.sort(
    (a, b) =>
      b.total - a.total ||
      b.word - a.word ||
      b.grammar - a.grammar ||
      a.name.localeCompare(b.name)
  );
  return rows;
}

function jsonOut_(obj, e) {
  const json = JSON.stringify(obj);
  const cb =
    e && e.parameter ? String(e.parameter.callback || "").trim() : "";
  if (cb && /^[A-Za-z_$][\w$]*$/.test(cb)) {
    return ContentService.createTextOutput(cb + "(" + json + ")").setMimeType(
      ContentService.MimeType.JAVASCRIPT
    );
  }
  return ContentService.createTextOutput(json).setMimeType(
    ContentService.MimeType.JSON
  );
}
