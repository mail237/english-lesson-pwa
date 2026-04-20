(function () {
  "use strict";

  const root = document.getElementById("wt-root");
  const titleEl = document.getElementById("wt-title");
  const loadingEl = document.getElementById("wt-loading");

  let lesson = null;
  let currentLessonPath = "data/lesson.json";
  let timerId = null;
  /** このページを開いているあいだ、すでに出した語（つぎのラウンドでかぶりにくくする） */
  let sessionUsedWordKeys = new Set();
  /** テストをまちがえずに ぜんぶせいかい した回数（連続） */
  let consecutivePerfectClears = 0;
  /** 連続クリアがたりたら 音声だけのテストへ */
  let audioQuizUnlocked = false;
  /** 音声テストで 1 問ごとの 連続正解数（まちがいで 0 にリセット） */
  let listeningStreak = 0;
  /** リスニング連続正解の目標を たっしたあと（文法へ進める） */
  let listeningCleared = false;
  /** 今のラウンドのスコア（正解のたびに加算） */
  let gameRoundScore = 0;
  /** いまのコンボ（まちがいで 0） */
  let gameQuizStreak = 0;
  /** このラウンドの最大コンボ */
  let gameQuizStreakRoundMax = 0;
  /** ページを開いているあいだの累計（次のラウンドで加算） */
  let gameSessionTotal = 0;
  /** セッション累計（単語） */
  let gameSessionWordTotal = 0;
  /** セッション累計（文法） */
  let gameSessionGrammarTotal = 0;

  // --- プレイヤー（ローカル） ---
  let currentPlayerId = null;
  let playerLocked = false;

  function playersStorageKey() {
    return lesson && lesson.id ? "wordtest-players-" + lesson.id : "wordtest-players-default";
  }

  function currentPlayerStorageKey() {
    return lesson && lesson.id ? "wordtest-current-player-" + lesson.id : "wordtest-current-player-default";
  }

  function loadPlayers() {
    try {
      var raw = localStorage.getItem(playersStorageKey());
      var arr = raw ? JSON.parse(raw) : null;
      if (!Array.isArray(arr)) return [];
      return arr
        .map(function (p) {
          if (!p || typeof p !== "object") return null;
          var id = String(p.id || "").trim();
          var name = String(p.name || "").trim();
          if (!id || !name) return null;
          return { id: id, name: name };
        })
        .filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  function savePlayers(players) {
    try {
      localStorage.setItem(playersStorageKey(), JSON.stringify(players || []));
    } catch (e) {
      /* ignore */
    }
  }

  function ensureDefaultPlayer() {
    var players = loadPlayers();
    if (!players.length) {
      var id = "p1";
      players = [{ id: id, name: "Player 1" }];
      savePlayers(players);
      try {
        localStorage.setItem(currentPlayerStorageKey(), id);
      } catch (e) {}
    }
    return players;
  }

  function getCurrentPlayer(players) {
    players = players || ensureDefaultPlayer();
    var id = null;
    try {
      id = String(localStorage.getItem(currentPlayerStorageKey()) || "").trim();
    } catch (e) {}
    if (!id) id = players[0] && players[0].id;
    var cur = players.find(function (p) {
      return p.id === id;
    });
    if (!cur) cur = players[0];
    currentPlayerId = cur ? cur.id : null;
    return cur;
  }

  function setCurrentPlayer(id) {
    try {
      localStorage.setItem(currentPlayerStorageKey(), String(id));
    } catch (e) {}
    currentPlayerId = String(id);
  }

  function addPlayer(name) {
    var nm = String(name || "").trim().slice(0, 20);
    if (!nm) return null;
    var players = ensureDefaultPlayer();
    var id = "p" + String(Date.now());
    players.push({ id: id, name: nm });
    savePlayers(players);
    setCurrentPlayer(id);
    return id;
  }

  function scoreKeyForPlayer(mode) {
    var base = lesson && lesson.id ? lesson.id : "default";
    var pid = currentPlayerId || "p1";
    return "wordtest-hi-" + base + "-" + pid + "-" + mode;
  }

  function scoreKeyFor(lessonId, playerId, mode) {
    var base = lessonId || "default";
    var pid = playerId || "p1";
    return "wordtest-hi-" + base + "-" + pid + "-" + mode;
  }

  function readScoreByKey(key) {
    try {
      var n = parseInt(localStorage.getItem(String(key)), 10);
      return isNaN(n) ? 0 : n;
    } catch (e) {
      return 0;
    }
  }

  function isGenericPlayerName(name) {
    var n = String(name || "").trim();
    if (!n) return true;
    return /^player\s*\d+$/i.test(n);
  }

  // --- 共有ランキング（Google Sheets / Apps Script） ---
  function remoteRankingUrlKey() {
    return "wordtest-remote-ranking-url";
  }
  function remoteRankingSecretKey() {
    return "wordtest-remote-ranking-secret";
  }
  function getRemoteRankingConfig() {
    var url = "";
    var secret = "";
    try {
      url = String(localStorage.getItem(remoteRankingUrlKey()) || "").trim();
      secret = String(localStorage.getItem(remoteRankingSecretKey()) || "").trim();
    } catch (e) {}
    return { url: url, secret: secret };
  }
  function setRemoteRankingConfig(url, secret) {
    try {
      localStorage.setItem(remoteRankingUrlKey(), String(url || "").trim());
      localStorage.setItem(remoteRankingSecretKey(), String(secret || "").trim());
    } catch (e) {}
  }
  function remoteRankingEnabled() {
    var c = getRemoteRankingConfig();
    return Boolean(c.url);
  }
  function remotePayloadBase() {
    var players = ensureDefaultPlayer();
    var cur = getCurrentPlayer(players);
    var name = cur && cur.name ? String(cur.name).trim() : "";
    if (!name || isGenericPlayerName(name)) return null;
    var lessonId = lesson && lesson.id ? lesson.id : "default";
    return { name: name, lessonId: lessonId };
  }
  function remoteUpsertMyHighScores() {
    var base = remotePayloadBase();
    if (!base) return;
    var c = getRemoteRankingConfig();
    if (!c.url) return;
    var wordHi = readHighScore();
    var grammarHi = readGrammarHighScore();
    var totalHi = (wordHi || 0) + (grammarHi || 0);
    var body = {
      action: "upsert",
      name: base.name,
      lessonId: base.lessonId,
      word: wordHi,
      grammar: grammarHi,
      total: totalHi,
      secret: c.secret || ""
    };
    try {
      fetch(c.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      }).catch(function () {});
    } catch (e) {
      /* ignore */
    }
  }
  async function remoteFetchLeaderboard() {
    var base = remotePayloadBase();
    if (!base) return [];
    var c = getRemoteRankingConfig();
    if (!c.url) return [];
    var url = c.url;
    var sep = url.indexOf("?") >= 0 ? "&" : "?";
    var req =
      url +
      sep +
      "action=leaderboard" +
      "&lessonId=" +
      encodeURIComponent(base.lessonId) +
      "&secret=" +
      encodeURIComponent(c.secret || "");
    try {
      var res = await fetch(req, { cache: "no-store" });
      if (!res.ok) return [];
      var json = await res.json();
      var rows = Array.isArray(json && json.rows) ? json.rows : [];
      return rows
        .map(function (r) {
          if (!r) return null;
          var name = String(r.name || "").trim();
          if (!name) return null;
          return {
            name: name,
            total: Number(r.total) || 0,
            word: Number(r.word) || 0,
            grammar: Number(r.grammar) || 0
          };
        })
        .filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  function buildLeaderboardRows() {
    var lessonId = lesson && lesson.id ? lesson.id : "default";
    var players = loadPlayers();
    var rows = players
      .filter(function (p) {
        return p && p.id && p.name && !isGenericPlayerName(p.name);
      })
      .map(function (p) {
        var w = readScoreByKey(scoreKeyFor(lessonId, p.id, "word"));
        var g = readScoreByKey(scoreKeyFor(lessonId, p.id, "grammar"));
        return { id: p.id, name: p.name, word: w, grammar: g, total: w + g };
      })
      .filter(function (r) {
        return r.total > 0 || r.word > 0 || r.grammar > 0;
      })
      .sort(function (a, b) {
        if (b.total !== a.total) return b.total - a.total;
        if (b.word !== a.word) return b.word - a.word;
        if (b.grammar !== a.grammar) return b.grammar - a.grammar;
        return String(a.name).localeCompare(String(b.name));
      });
    return rows;
  }

  function scoreStorageKey() {
    return scoreKeyForPlayer("word");
  }

  function readHighScore() {
    try {
      var n = parseInt(localStorage.getItem(scoreStorageKey()), 10);
      return isNaN(n) ? 0 : n;
    } catch (e) {
      return 0;
    }
  }

  function writeHighScoreIfBetter(score) {
    if (score <= 0) return;
    var prev = readHighScore();
    if (score > prev) {
      try {
        localStorage.setItem(scoreStorageKey(), String(score));
      } catch (e) {
        /* ignore */
      }
      remoteUpsertMyHighScores();
    }
  }

  function resetRoundScoreState() {
    gameRoundScore = 0;
    gameQuizStreak = 0;
    gameQuizStreakRoundMax = 0;
  }

  function applyCorrectAnswerPoints() {
    gameQuizStreak++;
    if (gameQuizStreak > gameQuizStreakRoundMax) {
      gameQuizStreakRoundMax = gameQuizStreak;
    }
    var bonus = Math.min(gameQuizStreak - 1, 12) * 5;
    gameRoundScore += 10 + bonus;
  }

  function resetComboStreak() {
    gameQuizStreak = 0;
  }

  function getScoreCopy() {
    var ws = (lesson && lesson.wordSprint) || {};
    return {
      hudTemplate:
        ws.scoreHudTemplateJa || "スコア {score} · コンボ {combo}",
      listenPenaltyPoints:
        typeof ws.scoreListenPenaltyPoints === "number" &&
        ws.scoreListenPenaltyPoints >= 0
          ? Math.min(999, Math.floor(ws.scoreListenPenaltyPoints))
          : 5,
      roundTitleJa: ws.scoreRoundTitleJa || "今回のスコア",
      bestJa: ws.scoreBestJa || "自己ベスト",
      newRecordJa: ws.scoreNewRecordJa || "新記録！",
      sessionJa: ws.scoreSessionJa || "セッション合計",
      comboMaxJa: ws.scoreComboMaxJa || "最大コンボ",
      welcomeBestJa: ws.scoreWelcomeBestJa || "自己ベスト",
    };
  }

  function applyWordListenPenalty() {
    var c = getScoreCopy();
    var p = c.listenPenaltyPoints || 0;
    if (p <= 0) return;
    gameRoundScore = Math.max(0, gameRoundScore - p);
  }

  function applyGrammarListenPenalty() {
    var gr = (lesson && lesson.grammarReorder) || {};
    var p =
      typeof gr.scoreListenPenaltyPoints === "number" &&
      gr.scoreListenPenaltyPoints >= 0
        ? Math.min(999, Math.floor(gr.scoreListenPenaltyPoints))
        : 5;
    if (p <= 0) return;
    grammarRoundScore = Math.max(0, grammarRoundScore - p);
  }

  function refreshScoreHudIn(card, isGrammar) {
    if (!card) return;
    var hud = card.querySelector(".wt-quiz__score-hud");
    if (!hud) return;
    hud.textContent = isGrammar ? formatGrammarScoreHud() : formatScoreHud();
  }

  function formatScoreHud() {
    var c = getScoreCopy();
    return String(c.hudTemplate)
      .replace(/\{score\}/g, String(gameRoundScore))
      .replace(/\{combo\}/g, String(gameQuizStreak));
  }

  // --- 文法（並び替え）スコア ---
  let grammarRoundScore = 0;
  let grammarStreak = 0;
  let grammarStreakRoundMax = 0;
  let grammarRoundTimeMs = 0;
  let grammarItemStartMs = 0;
  let grammarLastItemTimeMs = 0;

  function grammarScoreStorageKey() {
    return scoreKeyForPlayer("grammar");
  }

  function readGrammarHighScore() {
    try {
      var n = parseInt(localStorage.getItem(grammarScoreStorageKey()), 10);
      return isNaN(n) ? 0 : n;
    } catch (e) {
      return 0;
    }
  }

  function writeGrammarHighScoreIfBetter(score) {
    if (score <= 0) return;
    var prev = readGrammarHighScore();
    if (score > prev) {
      try {
        localStorage.setItem(grammarScoreStorageKey(), String(score));
      } catch (e) {
        /* ignore */
      }
      remoteUpsertMyHighScores();
    }
  }

  function resetGrammarScoreState() {
    grammarRoundScore = 0;
    grammarStreak = 0;
    grammarStreakRoundMax = 0;
    grammarRoundTimeMs = 0;
    grammarItemStartMs = Date.now();
    grammarLastItemTimeMs = 0;
  }

  function applyGrammarCorrectPoints(elapsedMs) {
    grammarStreak++;
    if (grammarStreak > grammarStreakRoundMax) {
      grammarStreakRoundMax = grammarStreak;
    }
    var bonus = Math.min(grammarStreak - 1, 12) * 5;
    var gr = (lesson && lesson.grammarReorder) || {};
    var base =
      typeof gr.scoreBasePoints === "number" && gr.scoreBasePoints > 0
        ? Math.min(200, Math.floor(gr.scoreBasePoints))
        : 20;
    var targetSec =
      typeof gr.scoreTimeTargetSec === "number" && gr.scoreTimeTargetSec > 0
        ? Math.min(300, Math.floor(gr.scoreTimeTargetSec))
        : 20;
    var perSec =
      typeof gr.scoreTimeBonusPerSec === "number" && gr.scoreTimeBonusPerSec >= 0
        ? Math.min(50, Math.floor(gr.scoreTimeBonusPerSec))
        : 2;
    var cap =
      typeof gr.scoreTimeBonusCap === "number" && gr.scoreTimeBonusCap >= 0
        ? Math.min(5000, Math.floor(gr.scoreTimeBonusCap))
        : 60;
    var sec = Math.max(0, (elapsedMs || 0) / 1000);
    var timeBonus = Math.max(0, Math.floor((targetSec - sec) * perSec));
    if (timeBonus > cap) timeBonus = cap;
    grammarRoundScore += base + bonus + timeBonus;
  }

  function resetGrammarComboStreak() {
    grammarStreak = 0;
  }

  function getGrammarScoreCopy() {
    var gr = (lesson && lesson.grammarReorder) || {};
    return {
      hudTemplate:
        gr.scoreHudTemplateJa || "スコア {score} · コンボ {combo} · {time}s",
      roundTitleJa: gr.scoreRoundTitleJa || "今回のスコア（文法）",
      bestJa: gr.scoreBestJa || "自己ベスト（文法）",
      newRecordJa: gr.scoreNewRecordJa || "新記録！",
      sessionJa: gr.scoreSessionJa || "セッション合計",
      comboMaxJa: gr.scoreComboMaxJa || "最大コンボ",
      timeTotalJa: gr.scoreTimeTotalJa || "合計タイム",
    };
  }

  function formatGrammarScoreHud() {
    var c = getGrammarScoreCopy();
    var sec = Math.max(0, grammarLastItemTimeMs / 1000);
    var secStr = (Math.round(sec * 10) / 10).toFixed(1);
    return String(c.hudTemplate)
      .replace(/\{score\}/g, String(grammarRoundScore))
      .replace(/\{combo\}/g, String(grammarStreak))
      .replace(/\{time\}/g, secStr);
  }

  function clearsNeededForAudio(data) {
    var ws = data && data.wordSprint;
    if (
      ws &&
      typeof ws.clearsForAudioQuiz === "number" &&
      ws.clearsForAudioQuiz > 0
    ) {
      return Math.min(50, Math.floor(ws.clearsForAudioQuiz));
    }
    return 10;
  }

  /** 文法ステージへ進むまでに必要な リスニング連続正解数 */
  function listeningStreakTarget(data) {
    var ws = data && data.wordSprint;
    if (ws && typeof ws.listeningStreakForGrammar === "number") {
      var n = Math.floor(ws.listeningStreakForGrammar);
      if (n <= 0) return 0;
      return Math.min(99, n);
    }
    return 15;
  }

  function clearTimer() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function lessonUrl() {
    return new URL(currentLessonPath, document.baseURI).href;
  }

  function lessonPathStorageKey() {
    return "wordtest-selected-lesson-path";
  }

  function readSelectedLessonPath() {
    try {
      var p = String(localStorage.getItem(lessonPathStorageKey()) || "").trim();
      return p || null;
    } catch (e) {
      return null;
    }
  }

  function writeSelectedLessonPath(p) {
    try {
      localStorage.setItem(lessonPathStorageKey(), String(p));
    } catch (e) {
      /* ignore */
    }
  }

  function lessonsIndexUrl() {
    return new URL("data/lessons/index.json", document.baseURI).href;
  }

  async function loadLessonsIndex() {
    var url = lessonsIndexUrl();
    try {
      var res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      var j = await res.json();
      if (!j || !Array.isArray(j.lessons)) return { lessons: [] };
      return j;
    } catch (e) {
      return { lessons: [] };
    }
  }

  /** index.json の track、または従来の grade から 中1/中2/中3/英会話 を推定 */
  function lessonTrackFromEntry(x) {
    if (!x || typeof x !== "object") return "";
    var t = String(x.track || "").trim();
    if (t === "中1" || t === "中2" || t === "中3" || t === "英会話") return t;
    var g = String(x.grade || "").trim();
    if (g === "中1" || g === "中2" || g === "中3") return g;
    if (g === "ラジオ") return "英会話";
    return "";
  }

  function renderTrackSelect(indexJson) {
    if (!root) return;
    emptyRoot();
    clearTimer();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    titleEl.textContent = "学年をえらぶ";

    var card = el("div", "wt-card wt-track-picker");
    card.appendChild(
      el(
        "p",
        "wt-lead",
        "中1・中2・中3・英会話のいずれかを選び、つぎに教材を選びます（プレイ中は切り替えできません）。"
      )
    );

    var raw = indexJson && Array.isArray(indexJson.lessons) ? indexJson.lessons : [];
    var hasAny = raw.some(function (x) {
      return x && x.path && x.label;
    });

    if (!hasAny) {
      card.appendChild(
        el(
          "p",
          "wt-quiz__note",
          "教材一覧（data/lessons/index.json）が見つからないため、いまの教材を使います。"
        )
      );
      var btn = el("button", "wt-btn wt-btn--primary", "つづける");
      btn.type = "button";
      btn.addEventListener("click", async function () {
        await selectLessonAndLoad("data/lesson.json");
      });
      card.appendChild(btn);
      root.appendChild(card);
      return;
    }

    var grid = el("div", "wt-track-grid");
    ["中1", "中2", "中3", "英会話"].forEach(function (tid) {
      var b = el("button", "wt-btn wt-btn--track", tid);
      b.type = "button";
      b.addEventListener("click", function () {
        renderLessonSelect(indexJson, tid);
      });
      grid.appendChild(b);
    });
    card.appendChild(grid);

    var keep = el("button", "wt-btn wt-btn--primary", "前回の教材でつづける");
    keep.type = "button";
    keep.addEventListener("click", async function () {
      var p = readSelectedLessonPath() || "data/lesson.json";
      await selectLessonAndLoad(p);
    });
    card.appendChild(keep);

    root.appendChild(card);
  }

  function renderLessonSelect(indexJson, trackId) {
    if (!root) return;
    emptyRoot();
    clearTimer();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    trackId = String(trackId || "").trim();
    titleEl.textContent = trackId ? trackId + "の教材をえらぶ" : "教材をえらぶ";

    var card = el("div", "wt-card wt-lesson-picker");
    card.appendChild(
      el(
        "p",
        "wt-lead",
        "この区分の教材から 1 つ選んでください。"
      )
    );

    var lessons = (indexJson && Array.isArray(indexJson.lessons) ? indexJson.lessons : [])
      .filter(function (x) {
        return x && x.path && x.label;
      })
      .map(function (x) {
        return {
          track: lessonTrackFromEntry(x),
          grade: String(x.grade || "").trim(),
          label: String(x.label || "").trim(),
          path: String(x.path || "").trim(),
        };
      })
      .filter(function (it) {
        if (!trackId) return true;
        return it.track === trackId;
      });

    var back = el("button", "wt-btn wt-btn--ghost wt-lesson-picker__back", "← 学年の選択に戻る");
    back.type = "button";
    back.addEventListener("click", function () {
      renderTrackSelect(indexJson);
    });
    card.appendChild(back);

    if (!lessons.length) {
      card.appendChild(
        el(
          "p",
          "wt-quiz__note",
          "この学年の教材はまだありません。ほかの学年を選ぶか、あとから追加されます。"
        )
      );
      root.appendChild(card);
      return;
    }

    var list = el("div", "wt-player__list");
    lessons.forEach(function (it) {
      var text = (it.grade ? it.grade + " — " : "") + it.label;
      var b = el("button", "wt-btn wt-btn--ghost wt-lesson-picker__item", text);
      b.type = "button";
      b.addEventListener("click", async function () {
        await selectLessonAndLoad(it.path);
      });
      list.appendChild(b);
    });
    card.appendChild(list);

    var keep = el("button", "wt-btn wt-btn--primary", "前回の教材でつづける");
    keep.type = "button";
    keep.addEventListener("click", async function () {
      var p = readSelectedLessonPath() || "data/lesson.json";
      await selectLessonAndLoad(p);
    });
    card.appendChild(keep);

    root.appendChild(card);
  }

  async function selectLessonAndLoad(path) {
    if (!path) path = "data/lesson.json";
    currentLessonPath = String(path);
    writeSelectedLessonPath(currentLessonPath);
    loadingEl && (loadingEl.textContent = "読み込み中です…");
    emptyRoot();
    root && root.appendChild(el("p", "wt-loading", "読み込み中です…"));
    try {
      lesson = await loadLessonJson();
    } catch (e) {
      showError("教材データを読み込めませんでした。");
      return;
    }

    // lesson が切り替わったので、プレイヤー・スコア関連のキーも切り替わる
    ensureDefaultPlayer();
    getCurrentPlayer();
    sessionUsedWordKeys.clear();
    consecutivePerfectClears = 0;
    audioQuizUnlocked = false;
    gameSessionTotal = 0;
    gameSessionWordTotal = 0;
    gameSessionGrammarTotal = 0;
    playerLocked = false;

    const conf = sprintConfig(lesson);
    if (!conf) {
      showError(
        "lesson.json に、wordSprint の設定と、単語の出所（vocabulary／keywords／dialogue／readingPassages など）が必要です。"
      );
      return;
    }
    titleEl.textContent = lesson.titleJa || lesson.title || conf.titleJa;
    renderWelcome(conf, { shortIntro: false });
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function normKey(w) {
    return String(w || "")
      .replace(/[\u2019\u2018\u201B\u2032\u0060\u00B4]/g, "'")
      .trim()
      .toLowerCase()
      .replace(/[.!?…,;:：。、]+$/g, "");
  }

  /** That's / it's など「1語としては意味がとりにくい」省略形（会話からは取り込まない） */
  function isSkippableContractionToken(low) {
    return /^[a-z]{1,15}'[a-z]{1,3}$/.test(low);
  }

  function purgeHintlessContractionGarbage(map) {
    map.forEach(function (entry, key) {
      if (key.indexOf(" ") !== -1) return;
      if (String(entry.hintJa || "").trim()) return;
      if (isSkippableContractionToken(key)) map.delete(key);
    });
  }

  var STOPWORDS = new Set(
    "a an the is are was were be been being to of in on for with by at or as it we you he she they i me him her us them my your his our their this that these those and but not so do does did have has had can could will would shall should may might must need dare ought".split(
      /\s+/
    )
  );

  function gatherSourceTexts(data) {
    const texts = [];
    (data.dialogue || []).forEach(function (line) {
      if (line && line.text) texts.push(String(line.text));
    });
    (data.readingPassages || []).forEach(function (t) {
      if (t) texts.push(String(t));
    });
    var ws = data.wordSprint;
    if (ws && ws.sourceTexts) {
      (ws.sourceTexts || []).forEach(function (t) {
        if (t) texts.push(String(t));
      });
    }
    return texts;
  }

  function tokenizeEnglish(text) {
    var raw = String(text);
    var re = /[A-Za-z]+(?:'[A-Za-z]+)?/g;
    var out = [];
    var m;
    while ((m = re.exec(raw)) !== null) {
      var t = m[0];
      var low = normKey(t);
      if (low.length < 2) continue;
      if (STOPWORDS.has(low)) continue;
      if (isSkippableContractionToken(low)) continue;
      out.push({ key: low, display: t });
    }
    return out;
  }

  function buildWordPool(data) {
    var map = new Map();
    function add(entry) {
      if (!entry || entry.word == null) return;
      var k = normKey(entry.word);
      if (!k) return;
      var word = String(entry.word).trim();
      var hintJa = entry.hintJa != null ? String(entry.hintJa) : "";
      if (!map.has(k)) {
        map.set(k, { word: word, hintJa: hintJa, fromList: true });
      } else if (hintJa && !map.get(k).hintJa) {
        map.get(k).hintJa = hintJa;
        map.get(k).fromList = true;
      }
    }
    (data.vocabulary || []).forEach(add);
    (data.keywords || []).forEach(add);

    var gloss = data.wordGlosses && typeof data.wordGlosses === "object"
      ? data.wordGlosses
      : {};
    gatherSourceTexts(data).forEach(function (text) {
      tokenizeEnglish(text).forEach(function (tok) {
        var k = tok.key;
        var g =
          gloss[k] != null && String(gloss[k]).trim() !== ""
            ? String(gloss[k]).trim()
            : "";
        if (map.has(k)) {
          if (g && !map.get(k).hintJa) map.get(k).hintJa = g;
          return;
        }
        map.set(k, { word: tok.display, hintJa: g, fromList: false });
      });
    });

    fillHintsFromPhrases(data, map);
    purgeHintlessContractionGarbage(map);

    var out = Array.from(map.values()).filter(function (e) {
      // 会話などから自動で拾った語は、意味（hintJa）がないと選択肢が変になりやすいので除外
      return e.fromList === true || String(e.hintJa || "").trim() !== "";
    });
    return shuffle(out);
  }

  /** vocabulary / keywords のフレーズに含まれる単語へ、同じ hintJa をのせる（take と take a picture など） */
  function fillHintsFromPhrases(data, map) {
    var entries = []
      .concat(data.vocabulary || [])
      .concat(data.keywords || [])
      .filter(function (e) {
        return (
          e &&
          e.word != null &&
          e.hintJa != null &&
          String(e.hintJa).trim() !== ""
        );
      });
    entries.sort(function (a, b) {
      return String(b.word).length - String(a.word).length;
    });
    map.forEach(function (entry) {
      var hint = (entry.hintJa || "").trim();
      if (hint) return;
      var low = normKey(entry.word);
      if (low.length < 2) return;
      for (var i = 0; i < entries.length; i++) {
        var parts = normKey(entries[i].word)
          .split(/[^a-z0-9']+/i)
          .filter(function (p) {
            return p.length >= 2;
          });
        if (parts.indexOf(low) === -1) continue;
        entry.hintJa = String(entries[i].hintJa).trim();
        return;
      }
    });
  }

  function pickRoundWords(pool, total, exclude) {
    var ex =
      exclude && exclude instanceof Set && exclude.size ? exclude : new Set();
    var seen = new Set();
    var out = [];
    function norm(w) {
      return normKey(w.word);
    }
    var without = shuffle(pool.filter(function (w) {
      return !ex.has(norm(w));
    }));
    var withEx = shuffle(pool.filter(function (w) {
      return ex.has(norm(w));
    }));
    [without, withEx].forEach(function (list) {
      list.forEach(function (w) {
        var k = norm(w);
        if (seen.has(k)) return;
        seen.add(k);
        out.push(w);
      });
    });
    return out.slice(0, Math.min(total, out.length));
  }

  function sprintConfig(data, options) {
    const ws = data.wordSprint;
    if (!ws || typeof ws !== "object") return null;
    const seconds =
      typeof ws.seconds === "number" && ws.seconds > 0
        ? Math.min(300, Math.floor(ws.seconds))
        : 30;
    const total =
      typeof ws.roundWordCount === "number" && ws.roundWordCount > 0
        ? Math.min(24, Math.floor(ws.roundWordCount))
        : typeof ws.maxWordsInSprint === "number" && ws.maxWordsInSprint > 0
          ? Math.min(24, Math.floor(ws.maxWordsInSprint))
          : 3;
    const pool = buildWordPool(data);
    if (!pool.length) return null;

    let words;
    var audioQuizUniqueWordCount;
    var audioQuizLapsTotal;

    if (audioQuizUnlocked) {
      var laps =
        typeof ws.audioQuizLaps === "number" && ws.audioQuizLaps > 0
          ? Math.min(20, Math.floor(ws.audioQuizLaps))
          : 3;
      var base = shuffle(pool.slice());
      words = [];
      for (var li = 0; li < laps; li++) {
        words = words.concat(shuffle(base.slice()));
      }
      audioQuizUniqueWordCount = base.length;
      audioQuizLapsTotal = laps;
    } else {
      const excludeMerged = new Set(sessionUsedWordKeys);
      if (options && options.excludeKeys instanceof Set) {
        options.excludeKeys.forEach((k) => excludeMerged.add(k));
      }
      const freshCount = pool.filter(
        (w) => !excludeMerged.has(normKey(w.word))
      ).length;
      let pickExclude;
      if (freshCount >= total) {
        pickExclude = excludeMerged;
      } else {
        sessionUsedWordKeys.clear();
        pickExclude = new Set();
      }
      words = pickRoundWords(pool, total, pickExclude);
      if (!words.length) return null;
    }

    var listeningStreakNeedConf = audioQuizUnlocked
      ? 0
      : listeningStreakTarget(data);

    var doneSubJaConf = audioQuizUnlocked
      ? ws.doneSubAudioJa ||
        "おつかれさまでした。教材の単語をすべて {laps} 周できました。続けて同じ形式でもう一度／最初からやり直すか選べます。"
      : ws.doneSubJa ||
        "おつかれさまでした。続けて別の単語に挑戦しますか？ それとも最初からやり直しますか？";

    return {
      seconds,
      words,
      titleJa: ws.titleJa || "単語テスト",
      audioQuiz: audioQuizUnlocked,
      clearsForAudioQuiz: clearsNeededForAudio(data),
      quizTitleJa: ws.quizTitleJa || "テスト",
      quizTitleAudioJa: ws.quizTitleAudioJa || "音声テスト",
      audioQuizLeadJa:
        ws.audioQuizLeadJa || "",
      audioQuizChoicesNoteJa:
        ws.audioQuizChoicesNoteJa ||
        "↓ 意味が合う日本語を 1 つ選んでください",
      audioQuizNoSynthJa:
        ws.audioQuizNoSynthJa ||
        "この端末では音声読み上げが使えないため、下に英語を表示しています。",
      audioQuizReplayJa: ws.audioQuizReplayJa || "もう一度 英語を聞く",
      quizReplayEnglishJa:
        ws.quizReplayEnglishJa ||
        ws.audioQuizReplayJa ||
        "英語をもう一度聞く",
      textQuizAutoSpeak: ws.textQuizAutoSpeak !== false,
      audioQuizCorrectLabelJa:
        ws.audioQuizCorrectLabelJa || "正解の英語",
      audioQuizWrongJa:
        ws.audioQuizWrongJa ||
        "不正解です。進捗や周回のカウントはそのままです。すぐにもう一度この問題に挑戦します。",
      audioQuizRetryAfterWrongMs:
        typeof ws.audioQuizRetryAfterWrongMs === "number" &&
        ws.audioQuizRetryAfterWrongMs >= 0
          ? Math.min(5000, Math.floor(ws.audioQuizRetryAfterWrongMs))
          : 1200,
      audioQuizNoHintSpeakJa:
        ws.audioQuizNoHintSpeakJa ||
        "",
      doneAudioUnlockJa:
        ws.doneAudioUnlockJa ||
        "{n} 回連続ですべて正解しました。次のテストからは、文字なしの音声テストになります。",
      memoIntroAudioLineJa:
        ws.memoIntroAudioLineJa || "",
      jumpToAudioQuizButtonJa:
        ws.jumpToAudioQuizButtonJa ||
        "音声テストへ（回数を待たずに切り替え）",
      jumpToAudioQuizAlreadyJa:
        ws.jumpToAudioQuizAlreadyJa ||
        "いまは音声テストのモードです",
      jumpToAudioQuizDoneJa:
        ws.jumpToAudioQuizDoneJa ||
        "次のラウンドから音声テストにする",
      jumpToAudioQuizDoneDoneJa:
        ws.jumpToAudioQuizDoneDoneJa ||
        "設定しました。次の「次の単語テスト」から、音声テストになります。",
      quizPromptTemplateJa:
        ws.quizPromptTemplateJa || "「{word}」の日本語の意味はどれですか。",
      quizPromptNoHintJa:
        ws.quizPromptNoHintJa ||
        "「{word}」（一覧の {n} 番目）の日本語の意味はどれですか。",
      studyHintJa:
        ws.studyHintJa || "",
      skipToTestButtonJa:
        ws.skipToTestButtonJa || "テストへ進む（待たない）",
      skipDuringCountHintJa:
        ws.skipDuringCountHintJa || "",
      nextRoundIntroJa:
        ws.nextRoundIntroJa || "",
      doneNextRoundJa: ws.doneNextRoundJa || "次の単語テスト",
      doneRestartFullJa: ws.doneRestartFullJa || "最初からやり直す",
      doneSubJa: doneSubJaConf || "",
      memoIntroJa:
        ws.memoIntroJa || "",
      memoButtonJa: ws.memoButtonJa || "学習を始める",
      listeningStreakNeed: listeningStreakNeedConf,
      audioQuizUniqueWordCount: audioQuizUniqueWordCount,
      audioQuizLapsTotal: audioQuizLapsTotal,
      audioQuizProgressJa:
        ws.audioQuizProgressJa ||
        "問題 {cur} / {total}（{lap} / {laps} 周目）",
      listeningStreakProgressJa:
        ws.listeningStreakProgressJa ||
        "リスニング連続正解 {cur} / {need}（{need} 問でクリア）",
      listeningClearedNoteJa:
        ws.listeningClearedNoteJa ||
        "リスニングクリア済みです。文法テストはメニューから入れます。",
      listeningClearTitleJa:
        ws.listeningClearTitleJa || "リスニング クリア！",
      listeningClearBodyJa:
        ws.listeningClearBodyJa ||
        "連続正解が続きました。次は文法テストに進みましょう。",
      listeningClearGoGrammarJa:
        ws.listeningClearGoGrammarJa || "文法テストへ",
      listeningMenuLeadJa:
        ws.listeningMenuLeadJa || "",
      listeningMenuContinueJa:
        ws.listeningMenuContinueJa || "リスニングを続ける",
      listeningMenuGrammarJa:
        ws.listeningMenuGrammarJa || "文法テストへ",
      grammarAnytimeButtonJa:
        ws.grammarAnytimeButtonJa || "文法（並び替え）",
      reverseQuizAfterMeaningQuiz: ws.reverseQuizAfterMeaningQuiz !== false,
      quizTitleReverseJa: ws.quizTitleReverseJa || "日本語 → 英語",
      quizReverseChoicesNoteJa:
        ws.quizReverseChoicesNoteJa ||
        "↓ 意味に合う英語を 1 つ選んでください",
      quizReversePromptNoHintJa:
        ws.quizReversePromptNoHintJa ||
        "一覧の {n} 番目の語として正しい英語を選んでください。",
      quizReverseReplayJa:
        ws.quizReverseReplayJa || "英語の発音を聞く",
    };
  }

  function hasText(t) {
    return t != null && String(t).trim() !== "";
  }

  var cachedEnglishVoice = null;
  var englishVoicesHooked = false;

  function refreshEnglishVoiceCache() {
    if (!window.speechSynthesis) return;
    var voices = window.speechSynthesis.getVoices();
    if (!voices || !voices.length) return;
    var en = voices.filter(function (v) {
      var l = (v.lang || "").toLowerCase();
      return l.indexOf("en") === 0;
    });
    if (!en.length) {
      cachedEnglishVoice = null;
      return;
    }
    function scoreVoice(v) {
      var n = (v.name + " " + (v.voiceURI || "")).toLowerCase();
      var s = 0;
      if (v.localService) s += 35;
      if (/en-us/.test((v.lang || "").toLowerCase())) s += 12;
      if (/en-gb/.test((v.lang || "").toLowerCase())) s += 8;
      if (
        /samantha|allison|ava|nicky|susan|karen|daniel|tom|jamie|serena|fiona|moira|tessa|veena|siri|enhanced|premium|natural|neural/.test(
          n
        )
      )
        s += 28;
      if (/google us english|microsoft.*english/.test(n)) s += 18;
      if (/compact|embedded|zarvox|whisper|albert/.test(n)) s -= 25;
      return s;
    }
    en.sort(function (a, b) {
      return scoreVoice(b) - scoreVoice(a);
    });
    cachedEnglishVoice = en[0];
  }

  function ensureEnglishVoiceHook() {
    if (englishVoicesHooked || !window.speechSynthesis) return;
    englishVoicesHooked = true;
    refreshEnglishVoiceCache();
    var syn = window.speechSynthesis;
    if (syn.addEventListener) {
      syn.addEventListener("voiceschanged", refreshEnglishVoiceCache);
    } else {
      syn.onvoiceschanged = refreshEnglishVoiceCache;
    }
  }

  /** 読み上げ用：略語の読みを安定させる */
  function normalizeEnglishForSpeech(text) {
    return String(text || "")
      // UFO は「ユー・エフ・オー」（júːèfóu）で読ませたいので読み上げ用に置換
      // （IPA自体は speechSynthesis が解釈できないため、近い英語表記へ）
      .replace(/\bU\.F\.O\.\b/gi, "you eff oh")
      .replace(/\bUFO\b/gi, "you eff oh");
  }

  /** 文まるごと 1 回で読み、端末で自然な英語声を優先 */
  function utterEnglish(text, lang, onEnd) {
    const raw = normalizeEnglishForSpeech(String(text).trim());
    if (!raw) {
      if (onEnd) onEnd();
      return;
    }
    const t = raw.replace(/\s+\?/, "?").replace(/\s+$/, "");
    if (!window.speechSynthesis) {
      if (onEnd) onEnd();
      return;
    }
    ensureEnglishVoiceHook();
    refreshEnglishVoiceCache();
    const u = new SpeechSynthesisUtterance(t);
    u.volume = 1;
    u.pitch = 1;
    if (cachedEnglishVoice) {
      u.voice = cachedEnglishVoice;
      u.lang = cachedEnglishVoice.lang || lang || "en-US";
    } else {
      u.lang = lang || "en-US";
    }
    var wc = t.split(/\s+/).filter(Boolean).length;
    if (wc <= 1) u.rate = 0.88;
    else if (wc <= 3) u.rate = 0.86;
    else if (wc <= 10) u.rate = 0.84;
    else u.rate = 0.8;
    // iOS などで onend が発火しないことがあるため保険でタイムアウトも用意
    var done = false;
    var tid = null;
    function finish() {
      if (done) return;
      done = true;
      if (tid) window.clearTimeout(tid);
      if (onEnd) onEnd();
    }
    u.onend = finish;
    u.onerror = finish;
    // 単語/短文の読み上げが詰まっても次へ進める
    tid = window.setTimeout(finish, Math.min(6500, 1300 + wc * 900));
    window.speechSynthesis.speak(u);
  }

  function speakWord(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    utterEnglish(text, "en-US", null);
  }

  function speakHintJapanese(text, onEnd) {
    var t = String(text || "").trim();
    if (!t) {
      if (onEnd) onEnd();
      return;
    }
    if (!window.speechSynthesis) {
      if (onEnd) onEnd();
      return;
    }
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(t);
    u.lang = "ja-JP";
    u.rate = 0.92;
    u.pitch = 1;
    u.onend = onEnd;
    window.speechSynthesis.speak(u);
  }

  function emptyRoot() {
    if (loadingEl) loadingEl.remove();
    root.innerHTML = "";
  }

  function showError(msg) {
    emptyRoot();
    titleEl.textContent = "エラーが発生しました";
    const card = el("div", "wt-card");
    const p = el("p", "wt-err");
    p.textContent = msg;
    card.appendChild(p);
    root.appendChild(card);
  }

  function renderPlayerSelect() {
    if (!root) return;
    emptyRoot();
    clearTimer();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    titleEl.textContent = "プレイヤー";
    if (playerLocked) {
      showError(
        "プレイ中はプレイヤーを切り替えられません。切り替えるときは「最初からやり直す」でリセットしてから選んでください。"
      );
      return;
    }
    var players = ensureDefaultPlayer();
    var cur = getCurrentPlayer(players);

    var card = el("div", "wt-card wt-player");
    card.appendChild(el("p", "wt-done__title", "プレイヤー切替"));
    card.appendChild(
      el(
        "p",
        "wt-lead",
        "この端末の中で、名前ごとに点数を保存できます。"
      )
    );
    var list = el("div", "wt-player__list");
    players.forEach(function (p) {
      var b = el(
        "button",
        "wt-btn wt-btn--ghost wt-player__item" +
          (cur && p.id === cur.id ? " wt-player__item--current" : ""),
        p.name
      );
      b.type = "button";
      b.addEventListener("click", function () {
        setCurrentPlayer(p.id);
        var next = sprintConfig(lesson);
        if (next) renderWelcome(next, { shortIntro: false });
        else showError("教材データを読み込めませんでした。");
      });
      list.appendChild(b);
    });
    card.appendChild(list);

    var add = el(
      "button",
      "wt-btn wt-btn--primary",
      "新しいプレイヤーを追加"
    );
    add.type = "button";
    add.addEventListener("click", function () {
      var nm = window.prompt("プレイヤー名（20文字まで）", "");
      if (nm == null) return;
      addPlayer(nm);
      var next = sprintConfig(lesson);
      if (next) renderWelcome(next, { shortIntro: false });
      else showError("教材データを読み込めませんでした。");
    });
    card.appendChild(add);

    // 共有ランキング設定（Google Sheets / Apps Script）
    var cfg = getRemoteRankingConfig();
    var cfgLabel = cfg.url ? "共有ランキング：設定済み" : "共有ランキング：未設定";
    card.appendChild(el("p", "wt-lead", cfgLabel));
    var btnCfg = el(
      "button",
      "wt-btn wt-btn--ghost",
      "共有ランキングを設定"
    );
    btnCfg.type = "button";
    btnCfg.addEventListener("click", function () {
      var cur = getRemoteRankingConfig();
      var url = window.prompt("共有ランキングURL（Apps ScriptのWebアプリURL）", cur.url || "");
      if (url == null) return;
      var secret = window.prompt("共有キー（空でもOK）", cur.secret || "");
      if (secret == null) return;
      setRemoteRankingConfig(url, secret);
      showError("設定しました。戻って続けてください。");
    });
    card.appendChild(btnCfg);

    var back = el("button", "wt-btn wt-btn--ghost", "戻る");
    back.type = "button";
    back.addEventListener("click", function () {
      var next = sprintConfig(lesson);
      if (next) renderWelcome(next, { shortIntro: false });
      else showError("教材データを読み込めませんでした。");
    });
    card.appendChild(back);

    root.appendChild(card);
  }

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  /** トップ：教材の雰囲気に合わせたイラスト（images/welcome-top.png） */
  function createWelcomeIllustration() {
    var wrap = document.createElement("div");
    wrap.className = "wt-welcome__illu";
    var label =
      lesson && lesson.titleJa
        ? lesson.titleJa + "のイメージ（体育館・バスケ・写真・新聞）"
        : "学校の体育館、バスケットボール、カメラと新聞のイラスト";
    wrap.setAttribute("role", "img");
    wrap.setAttribute("aria-label", label);
    var img = document.createElement("img");
    img.className = "wt-welcome__illu-img";
    img.src =
      new URL("images/welcome-top.png", document.baseURI).href + "?v=69";
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    wrap.appendChild(img);
    return wrap;
  }

  /** ① 覚える開始（shortIntro: つぎのラウンド用の短い説明） */
  function renderWelcome(conf, options) {
    if (!root) return;
    var players = ensureDefaultPlayer();
    var curPlayer = getCurrentPlayer(players);
    if (conf.audioQuiz) {
      emptyRoot();
      clearTimer();
      if (listeningCleared) {
        var cardM = el("div", "wt-card");
        if (hasText(conf.listeningMenuLeadJa)) {
          cardM.appendChild(el("p", "wt-lead", conf.listeningMenuLeadJa));
        }
        var bCont = el(
          "button",
          "wt-btn wt-btn--primary",
          conf.listeningMenuContinueJa
        );
        bCont.type = "button";
        bCont.addEventListener("click", function () {
          try {
            renderQuiz(conf, 0);
          } catch (e) {
            console.error(e);
            showError(
              "テストを表示できませんでした。ページを再読み込みしてください。"
            );
          }
        });
        cardM.appendChild(bCont);
        root.appendChild(cardM);
        return;
      }
      try {
        renderQuiz(conf, 0);
      } catch (e) {
        console.error(e);
        showError(
          "テストを表示できませんでした。ページを再読み込みしてください。"
        );
      }
      return;
    }
    emptyRoot();
    const shortIntro = options && options.shortIntro === true;
    const leadText = shortIntro ? conf.nextRoundIntroJa : conf.memoIntroJa;
    const card = el("div", "wt-card");
    if (!shortIntro) {
      card.appendChild(createWelcomeIllustration());
    }
    if (hasText(leadText)) {
      card.appendChild(el("p", "wt-lead", String(leadText)));
    }
    const btn = el("button", "wt-btn wt-btn--primary", conf.memoButtonJa);
    btn.type = "button";
    btn.addEventListener("click", () => renderSprint(conf));
    var who = el(
      "p",
      "wt-player__current",
      "プレイヤー： " + (curPlayer ? curPlayer.name : "—")
    );
    card.appendChild(who);

    if (!playerLocked) {
      var btnPlayer = el(
        "button",
        "wt-btn wt-btn--ghost wt-player__btn",
        "プレイヤー切替 / 追加"
      );
      btnPlayer.type = "button";
      btnPlayer.addEventListener("click", function () {
        renderPlayerSelect();
      });
      card.appendChild(btnPlayer);

      var btnLesson = el(
        "button",
        "wt-btn wt-btn--ghost wt-player__btn",
        "学年をえらぶ"
      );
      btnLesson.type = "button";
      btnLesson.addEventListener("click", async function () {
        var idx = await loadLessonsIndex();
        renderTrackSelect(idx);
      });
      card.appendChild(btnLesson);
    } else {
      card.appendChild(
        el("p", "wt-player__lock-note", "※プレイ中は切り替えできません")
      );
    }

    card.appendChild(btn);

    var hiWelcome = readHighScore();
    if (hiWelcome > 0) {
      var scW = getScoreCopy();
      card.appendChild(
        el(
          "p",
          "wt-welcome__best",
          scW.welcomeBestJa + " " + hiWelcome + " pt"
        )
      );
    }

    root.appendChild(card);
  }

  /** ② おぼえる ＋ 30秒 → 自動テスト（いつでもスキップ可） */
  function renderSprint(conf) {
    if (!root) return;
    playerLocked = true;
    clearTimer();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    emptyRoot();

    const card = el("div", "wt-card");
    let remaining = conf.seconds;

    if (hasText(conf.studyHintJa)) {
      card.appendChild(el("p", "wt-hint", String(conf.studyHintJa)));
    }

    const timer = el("div", "wt-timer");
    const tl = el("span", "wt-timer__label", "残り");
    const tn = el("span", "wt-timer__num", String(remaining));
    tn.setAttribute("aria-live", "polite");
    const tu = el("span", "wt-timer__unit", "秒");
    timer.appendChild(tl);
    timer.appendChild(tn);
    timer.appendChild(tu);
    card.appendChild(timer);

    if (hasText(conf.skipDuringCountHintJa)) {
      card.appendChild(el("p", "wt-skip-note", String(conf.skipDuringCountHintJa)));
    }

    conf.words.forEach((item, idx) => {
      const box = el("div", "wt-word");
      const ord = el("span", "wt-word__ord", String(idx + 1));
      box.appendChild(ord);
      const hintLine = (item.hintJa || "").trim();
      const ja = el(
        "p",
        "wt-word__ja",
        hintLine || "（メモなし）"
      );
      const en = el("p", "wt-word__en", item.word);
      const sp = el("button", "wt-word__speak", "▶ 発音");
      sp.type = "button";
      sp.addEventListener("click", () => speakWord(item.word));
      box.appendChild(ja);
      box.appendChild(en);
      box.appendChild(sp);
      card.appendChild(box);
    });

    const actions = el("div", "wt-actions");
    const btnTest = el(
      "button",
      "wt-btn wt-btn--ghost",
      conf.skipToTestButtonJa
    );
    btnTest.type = "button";

    function goQuiz() {
      clearTimer();
      try {
        renderQuiz(conf, 0);
      } catch (e) {
        console.error(e);
        showError("テストを表示できませんでした。ページを再読み込みしてください。");
      }
    }

    btnTest.addEventListener("click", goQuiz);
    actions.appendChild(btnTest);
    card.appendChild(actions);

    root.appendChild(card);

    function tick() {
      tn.textContent = String(Math.max(0, remaining));
    }
    tick();
    timerId = setInterval(() => {
      remaining -= 1;
      tick();
      if (remaining <= 0) {
        clearTimer();
        goQuiz();
      }
    }, 1000);
  }

  function promptFromTemplate(tpl, hint) {
    return String(tpl).replace(/\{hint\}/g, hint || "（いみ）");
  }

  function promptWordTemplate(tpl, word) {
    return String(tpl || "").replace(/\{word\}/g, String(word || "").trim() || "…");
  }

  function normMeaningLabel(s) {
    return String(s || "")
      .trim()
      .replace(/\s+/g, " ");
  }

  /**
   * クイズの選択肢の日本語ラベル。
   * ordinalForBlank: 正解カードでヒントが空のときだけ 0以上（ばんめ）。ほかは -1。
   */
  function meaningChoiceLabel(entry, ordinalForBlank) {
    var h = String(entry.hintJa || "").trim();
    if (h) return h;
    if (typeof ordinalForBlank === "number" && ordinalForBlank >= 0) {
      return "（" + String(ordinalForBlank + 1) + "番目のカードの意味）";
    }
    return "（「" + String(entry.word || "").trim() + "」の意味）";
  }

  /** 音声テストで 括弧内の英語などが 答えに つながるのを のぞく */
  function stripEnglishFromJapaneseHint(text) {
    var s = String(text || "");
    for (var pass = 0; pass < 4; pass++) {
      var next = s
        .replace(/（[^）]*[A-Za-z][^）]*）/g, "")
        .replace(/\([^)]*[A-Za-z][^)]*\)/g, "");
      if (next === s) break;
      s = next;
    }
    return normMeaningLabel(s.replace(/（\s*）/g, ""));
  }

  /** 音声テスト用：表示ラベルから 英語を のぞき、必要なら フォールバック */
  function quizMeaningDisplayLabel(entry, ordinalForBlank, audioQuiz) {
    var raw = meaningChoiceLabel(entry, ordinalForBlank);
    if (!audioQuiz) return normMeaningLabel(raw);
    raw = stripEnglishFromJapaneseHint(raw);
    raw = normMeaningLabel(raw);
    raw = raw.replace(
      /「[A-Za-z0-9][A-Za-z0-9\s'.?~-]*」の意味/g,
      "（別の語の意味）"
    );
    if (/[A-Za-z]{2,}/.test(raw)) {
      raw =
        ordinalForBlank >= 0
          ? "（" + String(ordinalForBlank + 1) + "番目のカードの意味）"
          : "（別の語の意味）";
    }
    return normMeaningLabel(raw);
  }

  function meaningCoreForSimilarity(label) {
    return stripEnglishFromJapaneseHint(normMeaningLabel(label)).replace(
      /\s/g,
      ""
    );
  }

  function meaningsAreTooClose(correctLabel, distractorLabel) {
    if (normMeaningLabel(correctLabel) === normMeaningLabel(distractorLabel))
      return true;
    var a = meaningCoreForSimilarity(correctLabel);
    var b = meaningCoreForSimilarity(distractorLabel);
    if (!a || !b) return false;
    if (a === b) return true;
    var L = a.length >= b.length ? a : b;
    var S = a.length < b.length ? a : b;
    if (S.length >= 2 && L.indexOf(S) !== -1) return true;
    return false;
  }

  /** take と take a picture など 片方が もう片方の フレーズに ふくまれるとき */
  function wordsArePhraseRelated(shorterNorm, longerNorm) {
    if (shorterNorm === longerNorm) return true;
    if (!shorterNorm || !longerNorm || longerNorm.length <= shorterNorm.length)
      return false;
    var esc = shorterNorm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(^|\\s)" + esc + "(\\s|$)").test(longerNorm);
  }

  function wordsAreTokenRelated(tNorm, wNorm) {
    if (tNorm === wNorm) return true;
    var a = tNorm.length <= wNorm.length ? tNorm : wNorm;
    var b = tNorm.length > wNorm.length ? tNorm : wNorm;
    return wordsArePhraseRelated(a, b);
  }

  /** 音声テストの複数周で 同じ語が かさなるので 第2クイズは 1 語 1 回にする */
  function uniqueWordsPreserveOrder(words) {
    var seen = new Set();
    var out = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w) continue;
      var k = normKey(w.word);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(w);
    }
    return out;
  }

  function buildPhase2ReverseWordList(conf) {
    if (!conf || conf.reverseQuizAfterMeaningQuiz === false) return [];
    if (conf.audioQuiz === true) {
      return shuffle(uniqueWordsPreserveOrder(conf.words));
    }
    return shuffle(conf.words.slice());
  }

  /** 第1クイズ（conf.words）での 先頭からの 番号（音声の重複にも対応） */
  function originalQuizPositionForTarget(conf, target) {
    var want = normKey(target.word);
    for (var i = 0; i < conf.words.length; i++) {
      if (normKey(conf.words[i].word) === want) return i + 1;
    }
    return 1;
  }

  /** ④ テスト：日本語の意味 → 英語を選ぶ（意味クイズのあと） */
  function renderReverseQuiz(conf, phaseWords, qIndex) {
    if (!root) return;
    clearTimer();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    emptyRoot();

    if (qIndex >= phaseWords.length) {
      renderDone(conf);
      return;
    }

    titleEl.textContent = conf.titleJa;

    const target = phaseWords[qIndex];
    const hintHas = Boolean((target.hintJa || "").trim());
    const pool = buildWordPool(lesson);
    const keyT = normKey(target.word);
    const usedKeys = new Set([keyT]);
    const usedLabels = new Set();
    usedLabels.add(String(target.word).trim());
    const wrongPick = [];

    function pushWrongEnIfOk(w) {
      const k = normKey(w.word);
      if (usedKeys.has(k)) return false;
      if (wordsAreTokenRelated(keyT, k)) return false;
      const lab = String(w.word || "").trim();
      if (!lab) return false;
      if (usedLabels.has(lab)) return false;
      usedKeys.add(k);
      usedLabels.add(lab);
      wrongPick.push(w);
      return true;
    }

    for (var pass = 0; pass < 2; pass++) {
      for (const w of shuffle(pool)) {
        if (wrongPick.length >= 2) break;
        pushWrongEnIfOk(w);
      }
      if (wrongPick.length >= 2) break;
    }

    if (wrongPick.length < 2) {
      for (const w of shuffle(pool)) {
        if (wrongPick.length >= 2) break;
        const k = normKey(w.word);
        if (usedKeys.has(k)) continue;
        const lab = String(w.word || "").trim();
        if (!lab || usedLabels.has(lab)) continue;
        usedKeys.add(k);
        usedLabels.add(lab);
        wrongPick.push(w);
      }
    }

    const optionWords = shuffle([target, ...wrongPick]);
    const card = el("div", "wt-card");
    const synthOn = Boolean(window.speechSynthesis);
    const head = el("p", "wt-quiz__title", conf.quizTitleReverseJa);
    const prog = el(
      "p",
      "wt-quiz__progress",
      "問題 " + (qIndex + 1) + " / " + phaseWords.length
    );
    const grid = el("div", "wt-choices");

    var jaPrompt = "";
    if (hintHas) {
      jaPrompt = normMeaningLabel(String(target.hintJa || ""));
    } else {
      jaPrompt = String(conf.quizReversePromptNoHintJa || "")
        .replace(/\{n\}/g, String(originalQuizPositionForTarget(conf, target)))
        .replace(/\{word\}/g, String(target.word).trim());
    }

    const prBlock = el("div", "wt-text-quiz wt-text-quiz--reverse");
    prBlock.appendChild(el("p", "wt-quiz__big-ja", jaPrompt));
    if (synthOn) {
      var replayRev = el(
        "button",
        "wt-btn wt-btn--ghost wt-text-quiz__replay",
        conf.quizReverseReplayJa
      );
      replayRev.type = "button";
      replayRev.addEventListener("click", function () {
        applyWordListenPenalty();
        refreshScoreHudIn(card, false);
        speakWord(target.word);
      });
      prBlock.appendChild(replayRev);
    }

    card.appendChild(head);
    card.appendChild(prog);
    card.appendChild(el("p", "wt-quiz__score-hud", formatScoreHud()));
    card.appendChild(prBlock);
    card.appendChild(
      el("p", "wt-audio-quiz__choices-hint", conf.quizReverseChoicesNoteJa)
    );
    card.appendChild(grid);

    const seenEnLabels = new Set();
    optionWords.forEach(function (opt) {
      var enText = String(opt.word || "").trim();
      if (seenEnLabels.has(enText)) {
        var u = 2;
        while (seenEnLabels.has(enText + "（" + u + "）")) u++;
        enText = enText + "（" + u + "）";
      }
      seenEnLabels.add(enText);
      const b = el("button", "wt-choice wt-choice--en-pick", enText);
      b.type = "button";
      b.setAttribute("aria-label", enText);
      b.addEventListener("click", function () {
        if (b.disabled) return;
        if (synthOn) speakWord(opt.word);
        const ok = normKey(opt.word) === keyT;
        if (ok) {
          applyCorrectAnswerPoints();
          b.classList.add("wt-choice--correct");
          b.disabled = true;
          grid.querySelectorAll(".wt-choice").forEach(function (x) {
            x.disabled = true;
          });
          window.setTimeout(function () {
            renderReverseQuiz(conf, phaseWords, qIndex + 1);
          }, 450);
        } else {
          resetComboStreak();
          b.classList.add("wt-choice--wrong");
          grid.querySelectorAll(".wt-choice").forEach(function (x) {
            x.disabled = true;
          });
          card.appendChild(
            el("p", "wt-quiz__note", "不正解です。次の問題へ進みます。")
          );
          window.setTimeout(function () {
            renderReverseQuiz(conf, phaseWords, qIndex + 1);
          }, 650);
        }
      });
      grid.appendChild(b);
    });

    root.appendChild(card);
  }

  /** ③ テスト：英語 → 日本語のいみを選ぶ */
  function renderQuiz(conf, qIndex) {
    if (!root) return;
    clearTimer();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    emptyRoot();

    if (qIndex >= conf.words.length) {
      const phase2 = buildPhase2ReverseWordList(conf);
      if (phase2.length) {
        renderReverseQuiz(conf, phase2, 0);
      } else {
        renderDone(conf);
      }
      return;
    }

    if (qIndex === 0) {
      playerLocked = true;
      resetRoundScoreState();
    }

    const target = conf.words[qIndex];
    const hintHas = Boolean((target.hintJa || "").trim());
    const pool = buildWordPool(lesson);
    const keyT = normKey(target.word);
    const audioStyleQuiz = conf.audioQuiz === true;
    const correctOrd = hintHas ? -1 : qIndex;
    function labelFor(entry, ord) {
      return normMeaningLabel(
        quizMeaningDisplayLabel(entry, ord, audioStyleQuiz)
      );
    }
    const correctDisplay = labelFor(target, correctOrd);
    const usedKeys = new Set([keyT]);
    const usedMeanings = new Set([correctDisplay]);
    const wrongPick = [];

    function pushWrongIfOk(w, strictSimilar) {
      const k = normKey(w.word);
      if (usedKeys.has(k)) return false;
      if (wordsAreTokenRelated(keyT, k)) return false;
      const dLabel = labelFor(w, -1);
      if (usedMeanings.has(dLabel)) return false;
      if (strictSimilar && meaningsAreTooClose(correctDisplay, dLabel))
        return false;
      usedKeys.add(k);
      usedMeanings.add(dLabel);
      wrongPick.push(w);
      return true;
    }

    for (var strictPass = 0; strictPass < 2; strictPass++) {
      const strict = strictPass === 0;
      for (const w of shuffle(pool)) {
        if (wrongPick.length >= 2) break;
        pushWrongIfOk(w, strict);
      }
      if (wrongPick.length >= 2) break;
    }

    if (wrongPick.length < 2) {
      for (const w of shuffle(pool)) {
        if (wrongPick.length >= 2) break;
        const k = normKey(w.word);
        if (usedKeys.has(k)) continue;
        const dLabel = labelFor(w, -1);
        if (usedMeanings.has(dLabel)) continue;
        usedKeys.add(k);
        usedMeanings.add(dLabel);
        wrongPick.push(w);
      }
    }

    const optionWords = shuffle([target, ...wrongPick]);

    const card = el("div", "wt-card");
    const synthOn = Boolean(window.speechSynthesis);
    const audioOn = audioStyleQuiz && synthOn;
    const head = el(
      "p",
      "wt-quiz__title",
      audioStyleQuiz ? conf.quizTitleAudioJa : conf.quizTitleJa
    );
    var progText =
      "問題 " + (qIndex + 1) + " / " + conf.words.length;
    if (
      audioStyleQuiz &&
      typeof conf.audioQuizLapsTotal === "number" &&
      conf.audioQuizLapsTotal > 0 &&
      typeof conf.audioQuizUniqueWordCount === "number" &&
      conf.audioQuizUniqueWordCount > 0
    ) {
      var lapNow =
        Math.floor(qIndex / conf.audioQuizUniqueWordCount) + 1;
      var progTpl =
        conf.audioQuizProgressJa ||
        "問題 {cur} / {total}（{lap} / {laps} 周目）";
      progText = String(progTpl)
        .replace(/\{cur\}/g, String(qIndex + 1))
        .replace(/\{total\}/g, String(conf.words.length))
        .replace(/\{lap\}/g, String(lapNow))
        .replace(/\{laps\}/g, String(conf.audioQuizLapsTotal));
    }
    const prog = el("p", "wt-quiz__progress", progText);
    const promptText = hintHas
      ? promptWordTemplate(conf.quizPromptTemplateJa, target.word)
      : String(conf.quizPromptNoHintJa || "")
          .replace(/\{n\}/g, String(qIndex + 1))
          .replace(/\{word\}/g, String(target.word).trim());
    const grid = el("div", "wt-choices");

    function speakQuestionEnglish() {
      if (!synthOn) return;
      speakWord(target.word);
    }

    let prBlock;
    if (audioStyleQuiz) {
      prBlock = el("div", "wt-audio-quiz");
      if (audioOn) {
        const replay = el(
          "button",
          "wt-btn wt-btn--ghost wt-audio-quiz__replay",
          conf.audioQuizReplayJa
        );
        replay.type = "button";
        replay.addEventListener("click", function () {
          applyWordListenPenalty();
          refreshScoreHudIn(card, false);
          speakQuestionEnglish();
        });
        prBlock.appendChild(replay);
      } else {
        prBlock.appendChild(
          el("p", "wt-audio-quiz__nosynth", conf.audioQuizNoSynthJa)
        );
      }
    } else {
      prBlock = el("div", "wt-text-quiz");
      prBlock.appendChild(el("p", "wt-quiz__big-en", String(target.word).trim()));
      if (synthOn) {
        var replayText = el(
          "button",
          "wt-btn wt-btn--ghost wt-text-quiz__replay",
          conf.quizReplayEnglishJa ||
            conf.audioQuizReplayJa ||
            "英語をもう一度聞く"
        );
        replayText.type = "button";
        replayText.addEventListener("click", function () {
          applyWordListenPenalty();
          refreshScoreHudIn(card, false);
          speakQuestionEnglish();
        });
        prBlock.appendChild(replayText);
      }
    }

    card.appendChild(head);
    card.appendChild(prog);
    card.appendChild(el("p", "wt-quiz__score-hud", formatScoreHud()));
    if (audioStyleQuiz && conf.listeningStreakNeed > 0) {
      if (!listeningCleared) {
        var streakLine = String(conf.listeningStreakProgressJa || "")
          .replace(/\{cur\}/g, String(listeningStreak))
          .replace(/\{need\}/g, String(conf.listeningStreakNeed));
        card.appendChild(el("p", "wt-quiz__listen-streak", streakLine));
      } else {
        card.appendChild(
          el(
            "p",
            "wt-quiz__listen-streak wt-quiz__listen-streak--done",
            conf.listeningClearedNoteJa
          )
        );
      }
    }
    card.appendChild(prBlock);
    if (audioStyleQuiz) {
      card.appendChild(
        el("p", "wt-audio-quiz__choices-hint", conf.audioQuizChoicesNoteJa)
      );
    }
    card.appendChild(grid);

    function restartFromTop() {
      consecutivePerfectClears = 0;
      listeningStreak = 0;
      resetRoundScoreState();
      sessionUsedWordKeys.clear();
      const next = sprintConfig(lesson);
      if (next) renderWelcome(next, { shortIntro: false });
    }

    const seenChoiceLabels = new Set();
    optionWords.forEach((opt, optIdx) => {
      const ord = normKey(opt.word) === keyT ? correctOrd : -1;
      var meaningText = labelFor(opt, ord);
      if (seenChoiceLabels.has(meaningText)) {
        var u = 2;
        while (seenChoiceLabels.has(meaningText + "（" + u + "）")) u++;
        meaningText = meaningText + "（" + u + "）";
      }
      seenChoiceLabels.add(meaningText);
      const b = el(
        "button",
        "wt-choice wt-choice--ja-meaning" +
          (audioStyleQuiz ? " wt-choice--audio-meaning" : ""),
        meaningText
      );
      b.type = "button";
      b.setAttribute("aria-label", meaningText);
      b.addEventListener("click", () => {
        if (b.disabled) return;
        if (!audioStyleQuiz && window.speechSynthesis) speakWord(opt.word);
        const ok = normKey(opt.word) === keyT;
        if (ok) {
          applyCorrectAnswerPoints();
          b.classList.add("wt-choice--correct");
          b.disabled = true;
          grid.querySelectorAll(".wt-choice").forEach((x) => {
            x.disabled = true;
          });
          if (audioStyleQuiz) {
            listeningStreak++;
            var needListen = conf.listeningStreakNeed;
            if (!listeningCleared && needListen > 0 && listeningStreak >= needListen) {
              listeningCleared = true;
              setTimeout(function () {
                renderListeningClear(conf);
              }, 450);
              return;
            }
            function advanceAudioCorrect() {
              window.setTimeout(function () {
                renderQuiz(conf, qIndex + 1);
              }, 380);
            }
            if (window.speechSynthesis) {
              window.speechSynthesis.cancel();
              utterEnglish(String(target.word).trim(), "en-US", advanceAudioCorrect);
            } else {
              window.setTimeout(advanceAudioCorrect, 900);
            }
            return;
          }
          setTimeout(() => renderQuiz(conf, qIndex + 1), 450);
        } else {
          resetComboStreak();
          if (audioStyleQuiz) {
            b.classList.add("wt-choice--wrong");
            grid.querySelectorAll(".wt-choice").forEach((x) => {
              x.disabled = true;
            });
            card.appendChild(
              el(
                "p",
                "wt-quiz__note wt-quiz__note--soft",
                conf.audioQuizWrongJa ||
                  "不正解です。進捗や周回のカウントはそのままです。すぐにもう一度この問題に挑戦します。"
              )
            );
            var retryMs = conf.audioQuizRetryAfterWrongMs;
            if (retryMs == null || retryMs < 0) retryMs = 1200;
            window.setTimeout(function () {
              renderQuiz(conf, qIndex);
            }, retryMs);
            return;
          }
          b.classList.add("wt-choice--wrong");
          grid.querySelectorAll(".wt-choice").forEach((x) => {
            x.disabled = true;
          });
          const note = el(
            "p",
            "wt-quiz__note",
            "不正解です。次の問題へ進みます。"
          );
          card.appendChild(note);
          window.setTimeout(() => renderQuiz(conf, qIndex + 1), 650);
        }
      });
      grid.appendChild(b);
    });

    root.appendChild(card);

    if (
      synthOn &&
      (audioStyleQuiz || conf.textQuizAutoSpeak !== false)
    ) {
      window.setTimeout(speakQuestionEnglish, 400);
    }
  }

  function renderListeningClear(conf) {
    if (!root) return;
    emptyRoot();
    clearTimer();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    titleEl.textContent = conf.titleJa;
    var card = el("div", "wt-card wt-listening-clear");
    card.appendChild(el("p", "wt-done__title", conf.listeningClearTitleJa));
    if (hasText(conf.listeningClearBodyJa)) {
      card.appendChild(el("p", "wt-lead", conf.listeningClearBodyJa));
    }
    root.appendChild(card);
    // 一方通行：クリアしたら自動で文法へ
    window.setTimeout(function () {
      listeningStreak = 0;
      renderGrammarReorder(0);
    }, 450);
  }

  function getGrammarConfig(data) {
    var g = data && data.grammarReorder;
    if (!g || typeof g !== "object") return null;
    var items = (Array.isArray(g.items) ? g.items : []).filter(function (it) {
      return it && Array.isArray(it.tokens) && it.tokens.length > 0;
    });
    if (!items.length) return null;
    return { raw: g, items: items };
  }

  function grammarTokensJoin(parts) {
    var s = parts.join(" ").trim();
    s = s.replace(/\s+([,?.!])/g, "$1");
    s = s.replace(/\s+:/g, ":");
    return s.replace(/\s+/g, " ");
  }

  /**
   * 並び替え UI 用：コンマ・ピリオド・? など「記号だけ」のチップを隣の語にくっつけ、
   * 正解英文（grammarTokensJoin）は元トークン列と同じになるように保つ。
   */
  function mergePunctuationChipsForReorder(parts) {
    var raw = parts.map(String);
    var out = [];
    var i = 0;
    while (i < raw.length) {
      var t = raw[i];
      if (/^[,.?!…:]+$/.test(t.trim())) {
        if (out.length) {
          out[out.length - 1] += t;
        } else if (i + 1 < raw.length) {
          i += 1;
          out.push(t + raw[i]);
        } else {
          out.push(t);
        }
      } else {
        out.push(t);
      }
      i += 1;
    }
    return out;
  }

  /** promptJa が 正解の英文と ほぼ同じなら 表示しない（答えがバレるのを防ぐ） */
  function grammarPromptLeaksAnswer(promptJa, expectedEnglish) {
    var p = String(promptJa || "").trim();
    var e = String(expectedEnglish || "").trim();
    if (!p || !e) return false;
    var strip = function (s) {
      return String(s)
        .replace(/（[^）]*）/g, "")
        .replace(/\([^)]*\)/g, "")
        .replace(/…+/g, "")
        .trim();
    };
    var a = grammarTokensJoin(strip(p).split(/\s+/).filter(Boolean)).toLowerCase();
    var b = grammarTokensJoin(strip(e).split(/\s+/).filter(Boolean)).toLowerCase();
    if (a && a === b) return true;
    if (a.length >= 10 && b.indexOf(a) === 0) return true;
    if (b.length >= 10 && a.indexOf(b) === 0) return true;
    return false;
  }

  /** 正解後に英文を自動読み上げするか（playAudioOnCorrect が優先、未指定時は autoPlayMeaningPauseListen） */
  function grammarShouldAutoPlayAfterCorrect(gr) {
    if (gr.playAudioOnCorrect === false) return false;
    if (gr.playAudioOnCorrect === true) return true;
    if (gr.autoPlayMeaningPauseListen === false) return false;
    return true;
  }

  function renderGrammarReorder(itemIndex, opts) {
    opts = opts || {};
    if (!root) return;
    var gc = getGrammarConfig(lesson);
    if (!gc) {
      showError(
        "文法・並び替えのデータ（grammarReorder.items）が lesson.json にありません。"
      );
      return;
    }
    var gr = gc.raw;
    var items = gc.items;
    if (itemIndex === 0) {
      playerLocked = true;
      resetGrammarScoreState();
    }
    if (itemIndex >= items.length) {
      renderGrammarAllDone(gr);
      return;
    }
    var item = items[itemIndex];
    grammarItemStartMs = Date.now();
    grammarLastItemTimeMs = 0;
    var tokenStrs = item.tokens.map(function (t) {
      return String(t);
    });
    if (gr.mergePunctuationChips !== false) {
      tokenStrs = mergePunctuationChipsForReorder(tokenStrs);
    }
    var expected = grammarTokensJoin(tokenStrs);
    var pool = shuffle(
      tokenStrs.map(function (text, id) {
        return { text: text, id: id };
      })
    );
    var built = [];
    /** 解答欄で「位置入れ替え」用：最初に選んだ built のインデックス */
    var swapPick = null;

    emptyRoot();
    clearTimer();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    var testStyle = gr.testStyle !== false;
    titleEl.textContent =
      gr.titleJa || (testStyle ? "文法テスト" : "文法・並び替え");

    var card = el(
      "div",
      "wt-card wt-grammar" + (testStyle ? " wt-grammar--test" : "")
    );

    // スコア表示（文法）
    card.appendChild(el("p", "wt-quiz__score-hud", formatGrammarScoreHud()));

    if (testStyle) {
      var head = el("div", "wt-grammar__test-head");
      head.appendChild(
        el(
          "p",
          "wt-grammar__test-label",
          gr.testSectionLabelJa || "文法テスト"
        )
      );
      head.appendChild(
        el(
          "p",
          "wt-grammar__test-no",
          (gr.testQuestionPrefixJa || "問") +
            " " +
            (itemIndex + 1) +
            " / " +
            items.length
        )
      );
      card.appendChild(head);
      var stemText = gr.testStemJa != null ? String(gr.testStemJa).trim() : "";
      if (stemText) {
        card.appendChild(el("p", "wt-grammar__test-stem", stemText));
      }
    } else {
      var leadText = gr.leadJa != null ? String(gr.leadJa).trim() : "";
      if (leadText) {
        card.appendChild(el("p", "wt-grammar__lead", leadText));
      }
    }

    var meaningJa = item.meaningJa != null ? String(item.meaningJa).trim() : "";
    if (meaningJa) {
      var meaningBox = el(
        "div",
        "wt-grammar__meaning wt-grammar__meaning--hero" +
          (testStyle ? " wt-grammar__meaning--test" : "")
      );
      meaningBox.appendChild(
        el(
          "p",
          "wt-grammar__meaning-label wt-grammar__meaning-label--subtle",
          testStyle
            ? gr.meaningStemLabelJa || "内容（日本語）"
            : gr.meaningSectionLabelJa || "日本語の意味"
        )
      );
      meaningBox.appendChild(
        el(
          "p",
          "wt-grammar__meaning-body wt-grammar__meaning-body--hero",
          meaningJa
        )
      );
      card.appendChild(meaningBox);
    }

    var coachText = gr.comprehensionCoachJa != null ? String(gr.comprehensionCoachJa).trim() : "";
    if (meaningJa && gr.comprehensionCoach !== false && coachText) {
      card.appendChild(
        el(
          "p",
          "wt-grammar__coach",
          coachText
        )
      );
    }

    var promptRaw = item.promptJa != null ? String(item.promptJa).trim() : "";
    if (promptRaw && !grammarPromptLeaksAnswer(promptRaw, expected)) {
      card.appendChild(
        el(
          "p",
          testStyle ? "wt-grammar__prompt wt-grammar__prompt--test" : "wt-grammar__prompt",
          (testStyle ? (gr.testPointPrefixJa || "出題のねらい：") : "") +
            promptRaw
        )
      );
    }

    if (!testStyle) {
      card.appendChild(
        el(
          "p",
          "wt-grammar__progress",
          "問題 " + (itemIndex + 1) + " / " + items.length
        )
      );
    }

    function speakExpectedSentence() {
      if (!window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      utterEnglish(expected, "en-US", null);
    }

    var listenBlock = el(
      "div",
      "wt-grammar__listen" + (testStyle ? " wt-grammar__listen--test" : "")
    );
    var listenLeadText = "";
    if (testStyle) {
      listenLeadText =
        gr.listenLeadTestJa != null ? String(gr.listenLeadTestJa).trim() : "";
    } else {
      listenLeadText =
        gr.listenLeadJa != null ? String(gr.listenLeadJa).trim() : "";
    }
    if (listenLeadText) {
      listenBlock.appendChild(
        el("p", "wt-grammar__listen-lead", listenLeadText)
      );
    }
    if (window.speechSynthesis) {
      var btnListen = el(
        "button",
        "wt-btn wt-btn--ghost wt-grammar__play",
        testStyle
          ? gr.playSentenceTestJa || "音声を再生（任意）"
          : gr.playSentenceJa || "英文を聞く"
      );
      btnListen.type = "button";
      btnListen.addEventListener("click", function () {
        applyGrammarListenPenalty();
        refreshScoreHudIn(card, true);
        speakExpectedSentence();
      });
      listenBlock.appendChild(btnListen);
    } else {
      listenBlock.appendChild(
        el(
          "p",
          "wt-grammar__nosynth",
          gr.listenNoSynthJa ||
            "この端末では読み上げが使えないため、目安の英文を表示します。"
        )
      );
      listenBlock.appendChild(
        el("p", "wt-grammar__fallback-en", expected)
      );
    }
    card.appendChild(listenBlock);

    var builtEl = el("div", "wt-scramble__built");
    var poolEl = el("div", "wt-scramble__pool");
    var feedbackEl = el("p", "wt-grammar__feedback");

    var btnClearBuilt = el(
      "button",
      "wt-btn wt-btn--ghost wt-scramble__clear-built",
      gr.clearBuiltJa || "並べた語をすべて候補に戻す"
    );
    btnClearBuilt.type = "button";
    btnClearBuilt.hidden = true;

    function paint() {
      if (!built.length) {
        swapPick = null;
      } else if (
        swapPick !== null &&
        (swapPick < 0 || swapPick >= built.length)
      ) {
        swapPick = null;
      }
      builtEl.innerHTML = "";
      poolEl.innerHTML = "";
      built.forEach(function (tok, bi) {
        var slot = el("span", "wt-built-slot");
        var chipClass = "wt-chip wt-chip--built";
        if (swapPick !== null && swapPick === bi) {
          chipClass += " wt-chip--built-pick";
        }
        var chip = el("button", chipClass, tok.text);
        chip.type = "button";
        chip.addEventListener("click", function () {
          if (swapPick === null) {
            swapPick = bi;
            paint();
            return;
          }
          if (swapPick === bi) {
            swapPick = null;
            paint();
            return;
          }
          var tmp = built[swapPick];
          built[swapPick] = built[bi];
          built[bi] = tmp;
          swapPick = null;
          paint();
        });
        var ret = el(
          "button",
          "wt-chip__return",
          gr.returnOneChipSymbolJa || "↓"
        );
        ret.type = "button";
        ret.setAttribute(
          "aria-label",
          gr.returnOneChipAriaJa || "この語だけ下の候補に戻す"
        );
        ret.addEventListener("click", function (ev) {
          ev.stopPropagation();
          built.splice(bi, 1);
          pool.push(tok);
          if (swapPick === bi) {
            swapPick = null;
          } else if (swapPick !== null && swapPick > bi) {
            swapPick -= 1;
          }
          paint();
        });
        slot.appendChild(chip);
        slot.appendChild(ret);
        builtEl.appendChild(slot);
      });
      pool.forEach(function (tok, pi) {
        var chip = el("button", "wt-chip wt-chip--pool", tok.text);
        chip.type = "button";
        chip.addEventListener("click", function () {
          pool.splice(pi, 1);
          if (swapPick === null) {
            built.push(tok);
          } else {
            var k = swapPick;
            if (k < 0) k = 0;
            if (k > built.length) k = built.length;
            built.splice(k, 0, tok);
            swapPick = null;
          }
          paint();
        });
        poolEl.appendChild(chip);
      });
      poolEl.className =
        "wt-scramble__pool" +
        (swapPick !== null && built.length > 0
          ? " wt-scramble__pool--insert-hint"
          : "");
      btnClearBuilt.hidden = built.length === 0;
    }

    btnClearBuilt.addEventListener("click", function () {
      if (!built.length) return;
      while (built.length) {
        pool.push(built.pop());
      }
      swapPick = null;
      feedbackEl.textContent = "";
      feedbackEl.className = "wt-grammar__feedback";
      paint();
    });

    card.appendChild(
      el(
        "p",
        "wt-scramble__label" +
          (testStyle ? " wt-scramble__label--test" : ""),
        testStyle
          ? gr.answerAreaLabelJa || "【解答欄】語を正しい順に並べる"
          : gr.answerAreaLabelJa || "あなたの答え（文の順）"
      )
    );
    card.appendChild(builtEl);
    card.appendChild(btnClearBuilt);
    card.appendChild(
      el(
        "p",
        "wt-scramble__hint",
        (testStyle ? gr.testOperateNoteJa : null) ||
          gr.scrambleHintJa ||
          (testStyle
            ? "下の語をタップで**末尾**へ。**挿入**：解答欄で挿入したい位置の語を1回タップしてから下の語をタップ → **その語の前**に入ります。**並んだ語を続けて2回タップ**で入れ替え。**↓**でその1語だけ**候補**に戻せます。「" +
              (gr.clearBuiltJa || "並べた語をすべて候補に戻す") +
              "」ですべて戻せます。"
            : "下の語は**何も選んでいないとき**は末尾へ。**挿入**：上で位置の語を1回タップ → 下の語で**その前**に挿入。**2回タップ**で入れ替え。**↓**でその1語だけ**候補**に戻せます。「並べた語をすべて候補に戻す」で全部戻せます。")
      )
    );
    card.appendChild(poolEl);

    var actions = el("div", "wt-actions");
    var checkJa = testStyle
      ? gr.submitAnswerJa || "解答する"
      : gr.checkJa || "これで OK";
    var resetJa = testStyle
      ? gr.resetTestJa || "並べ替えをやり直す"
      : gr.resetJa || "やり直す";
    var wrongJa = testStyle
      ? gr.wrongTestJa ||
          "不正解です。語の順を確かめて、もう一度解答してください。"
      : gr.wrongJa ||
          "順序がまだ違います。語を入れ替えてから、もう一度どうぞ。";
    var fillEmptyJa = testStyle
      ? gr.fillAnswerTestJa ||
          "解答欄に語を並べてから、「解答する」を押してください。"
      : "語を並べてから、ボタンを押してください。";

    var btnCheck = el("button", "wt-btn wt-btn--primary", checkJa);
    btnCheck.type = "button";
    btnCheck.addEventListener("click", function () {
      feedbackEl.textContent = "";
      feedbackEl.className = "wt-grammar__feedback";
      if (!built.length) {
        feedbackEl.textContent = fillEmptyJa;
        feedbackEl.className =
          "wt-grammar__feedback wt-grammar__feedback--wrong";
        return;
      }
      if (
        grammarTokensJoin(
          built.map(function (x) {
            return x.text;
          })
        ) === expected
      ) {
        grammarLastItemTimeMs = Math.max(0, Date.now() - grammarItemStartMs);
        grammarRoundTimeMs += grammarLastItemTimeMs;
        applyGrammarCorrectPoints(grammarLastItemTimeMs);
        renderGrammarMeaningPause(itemIndex, item, expected, gr);
        return;
      }
      resetGrammarComboStreak();
      feedbackEl.textContent = wrongJa;
      feedbackEl.className =
        "wt-grammar__feedback wt-grammar__feedback--wrong";
    });
    actions.appendChild(btnCheck);

    var btnReset = el("button", "wt-btn wt-btn--ghost", resetJa);
    btnReset.type = "button";
    btnReset.addEventListener("click", function () {
      pool = shuffle(
        tokenStrs.map(function (text, id) {
          return { text: text, id: id };
        })
      );
      built = [];
      swapPick = null;
      feedbackEl.textContent = "";
      feedbackEl.className = "wt-grammar__feedback";
      paint();
    });
    actions.appendChild(btnReset);

    card.appendChild(feedbackEl);
    card.appendChild(actions);
    root.appendChild(card);
    paint();
    if (
      window.speechSynthesis &&
      gr.autoPlayListenOnOpen === true &&
      !opts.suppressAutoListenOnce
    ) {
      window.setTimeout(speakExpectedSentence, 450);
    }
  }

  /** 正解後：英文と日本語の意味をあわせて意識する一歩 */
  function renderGrammarMeaningPause(itemIndex, item, expected, gr) {
    var pauseOn =
      gr.meaningPauseAfterCorrect !== false &&
      item.meaningJa != null &&
      String(item.meaningJa).trim();
    if (!pauseOn) {
      var suppressNextAutoListen =
        window.speechSynthesis &&
        grammarShouldAutoPlayAfterCorrect(gr) &&
        gr.autoPlayListenOnOpen === true;
      if (window.speechSynthesis && grammarShouldAutoPlayAfterCorrect(gr)) {
        window.setTimeout(function () {
          utterEnglish(expected, "en-US", null);
        }, 320);
      }
      renderGrammarReorder(itemIndex + 1, {
        suppressAutoListenOnce: !!suppressNextAutoListen,
      });
      return;
    }
    var meaningJa = String(item.meaningJa).trim();
    var gc = getGrammarConfig(lesson);
    var nItems = gc && gc.items ? gc.items.length : 0;

    emptyRoot();
    clearTimer();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    var testStyle = gr.testStyle !== false;
    titleEl.textContent =
      gr.titleJa || (testStyle ? "文法テスト" : "文法・並び替え");

    var card = el("div", "wt-card wt-grammar wt-grammar-meaning-pause");
    card.appendChild(el("p", "wt-quiz__score-hud", formatGrammarScoreHud()));
    card.appendChild(
      el(
        "p",
        "wt-grammar-meaning-pause__label",
        gr.meaningPauseSectionJa || "意味の確認"
      )
    );
    var pauseLead =
      gr.meaningPauseLeadJa != null ? String(gr.meaningPauseLeadJa).trim() : "";
    if (pauseLead) {
      card.appendChild(el("p", "wt-grammar-meaning-pause__lead", pauseLead));
    }
    card.appendChild(
      el("p", "wt-grammar-meaning-pause__en", expected)
    );
    card.appendChild(
      el(
        "p",
        "wt-grammar-meaning-pause__ja-label",
        gr.meaningPauseJaLabelJa || "内容（日本語）"
      )
    );
    card.appendChild(el("p", "wt-grammar-meaning-pause__ja", meaningJa));
    if (nItems > 0) {
      card.appendChild(
        el(
          "p",
          "wt-grammar-meaning-pause__prog",
          (gr.testQuestionPrefixJa || "問") +
            " " +
            (itemIndex + 1) +
            " / " +
            nItems
        )
      );
    }

    var actions = el("div", "wt-actions");
    if (window.speechSynthesis) {
      var btnReplay = el(
        "button",
        "wt-btn wt-btn--ghost",
        gr.meaningPauseReplayJa || "英文をもう一度聞く"
      );
      btnReplay.type = "button";
      btnReplay.addEventListener("click", function () {
        applyGrammarListenPenalty();
        refreshScoreHudIn(card, true);
        utterEnglish(expected, "en-US", null);
      });
      actions.appendChild(btnReplay);
    }

    var autoAdvance =
      gr.meaningPauseAutoAdvance !== false &&
      gr.meaningPauseAfterCorrect !== false;
    var gone = false;
    var autoTid = null;
    function goNextGrammarItem() {
      if (gone) return;
      gone = true;
      if (autoTid) {
        window.clearTimeout(autoTid);
        autoTid = null;
      }
      renderGrammarReorder(itemIndex + 1);
    }

    if (autoAdvance) {
      var gapMs =
        typeof gr.meaningPauseAutoAdvanceAfterSpeechMs === "number" &&
        gr.meaningPauseAutoAdvanceAfterSpeechMs >= 0
          ? Math.min(4000, Math.floor(gr.meaningPauseAutoAdvanceAfterSpeechMs))
          : 420;
      var noSynthMs =
        typeof gr.meaningPauseAutoAdvanceNoSynthMs === "number" &&
        gr.meaningPauseAutoAdvanceNoSynthMs >= 0
          ? Math.min(8000, Math.floor(gr.meaningPauseAutoAdvanceNoSynthMs))
          : 1800;
      function afterSpeechOrWait() {
        if (gone) return;
        if (window.speechSynthesis && grammarShouldAutoPlayAfterCorrect(gr)) {
          window.setTimeout(function () {
            utterEnglish(expected, "en-US", function () {
              window.setTimeout(goNextGrammarItem, gapMs);
            });
          }, 450);
        } else {
          autoTid = window.setTimeout(goNextGrammarItem, noSynthMs);
        }
      }
      afterSpeechOrWait();
      var btnSkip = el(
        "button",
        "wt-btn wt-btn--ghost",
        gr.meaningPauseSkipJa || gr.meaningPauseNextJa || "次の問題へ"
      );
      btnSkip.type = "button";
      btnSkip.addEventListener("click", goNextGrammarItem);
      actions.appendChild(btnSkip);
    } else {
      var btnNext = el(
        "button",
        "wt-btn wt-btn--primary",
        gr.meaningPauseNextJa || "次の問題へ"
      );
      btnNext.type = "button";
      btnNext.addEventListener("click", goNextGrammarItem);
      actions.appendChild(btnNext);
    }

    card.appendChild(actions);
    root.appendChild(card);

    if (!autoAdvance && window.speechSynthesis && grammarShouldAutoPlayAfterCorrect(gr)) {
      window.setTimeout(function () {
        utterEnglish(expected, "en-US", null);
      }, 450);
    }
  }

  function renderGrammarAllDone(gr) {
    emptyRoot();
    var doneTest = gr.testStyle !== false;
    titleEl.textContent =
      gr.titleJa || (doneTest ? "文法テスト" : "文法・並び替え");

    // 文法スコア：自己ベスト更新とセッション合算
    gameSessionTotal += grammarRoundScore;
    gameSessionGrammarTotal += grammarRoundScore;
    var prevHi = readGrammarHighScore();
    var isNewRecord = grammarRoundScore > prevHi && grammarRoundScore > 0;
    writeGrammarHighScoreIfBetter(grammarRoundScore);
    var hiNow = readGrammarHighScore();

    var card = el(
      "div",
      "wt-card" + (doneTest ? " wt-grammar-test-done" : "")
    );
    card.appendChild(
      el(
        "p",
        "wt-done__title",
        gr.allDoneTitleJa || (doneTest ? "すべて解答しました" : "文法クリア！")
      )
    );
    var sCopy = getGrammarScoreCopy();
    var scoreBox = el("div", "wt-score-card");
    scoreBox.appendChild(el("p", "wt-score-card__label", sCopy.roundTitleJa));
    scoreBox.appendChild(
      el("p", "wt-score-card__value", String(grammarRoundScore))
    );
    scoreBox.appendChild(
      el(
        "p",
        "wt-score-card__combo",
        sCopy.comboMaxJa + " ×" + grammarStreakRoundMax
      )
    );
    scoreBox.appendChild(
      el(
        "p",
        "wt-score-card__session",
        sCopy.sessionJa +
          " " +
          gameSessionTotal +
          " pt（単語 " +
          gameSessionWordTotal +
          " / 文法 " +
          gameSessionGrammarTotal +
          "）"
      )
    );
    var tSec = Math.max(0, grammarRoundTimeMs / 1000);
    scoreBox.appendChild(
      el(
        "p",
        "wt-score-card__time",
        sCopy.timeTotalJa + " " + (Math.round(tSec * 10) / 10).toFixed(1) + " s"
      )
    );
    var bestStr = sCopy.bestJa + " " + hiNow + " pt";
    if (isNewRecord) {
      bestStr += " · " + sCopy.newRecordJa;
      scoreBox.classList.add("wt-score-card--new");
    }
    scoreBox.appendChild(el("p", "wt-score-card__best", bestStr));
    card.appendChild(scoreBox);

    function renderRankList(wrap, rows, meName) {
      var list = el("div", "wt-rank__list");
      var maxShow = 8;
      var shown = rows.slice(0, maxShow);
      shown.forEach(function (r, idx) {
        var isMe = meName && String(r.name).trim() === String(meName).trim();
        var row = el("div", "wt-rank__row" + (isMe ? " wt-rank__row--me" : ""));
        row.appendChild(el("span", "wt-rank__no", String(idx + 1)));
        row.appendChild(el("span", "wt-rank__name", r.name));
        row.appendChild(el("span", "wt-rank__score", String(r.total) + " pt"));
        list.appendChild(row);
      });
      if (meName) {
        var myIndex = rows.findIndex(function (r) {
          return String(r.name).trim() === String(meName).trim();
        });
        if (myIndex >= maxShow && myIndex >= 0) {
          var me = rows[myIndex];
          list.appendChild(el("div", "wt-rank__sep", "…"));
          var rowMe = el("div", "wt-rank__row wt-rank__row--me");
          rowMe.appendChild(el("span", "wt-rank__no", String(myIndex + 1)));
          rowMe.appendChild(el("span", "wt-rank__name", me.name));
          rowMe.appendChild(el("span", "wt-rank__score", String(me.total) + " pt"));
          list.appendChild(rowMe);
        }
      }
      wrap.appendChild(list);
    }

    // ランキング（共有設定があれば共有を優先）
    var players = ensureDefaultPlayer();
    var curP = getCurrentPlayer(players);
    var meName = curP && curP.name ? String(curP.name).trim() : "";
    if (meName && !isGenericPlayerName(meName)) {
      remoteUpsertMyHighScores();
    }

    var wrap = el("div", "wt-rank");
    wrap.appendChild(el("p", "wt-rank__title", remoteRankingEnabled() ? "ランキング（共有）" : "ランキング（この端末）"));
    card.appendChild(wrap);

    if (remoteRankingEnabled() && meName && !isGenericPlayerName(meName)) {
      var loading = el("p", "wt-lead", "ランキング読み込み中…");
      wrap.appendChild(loading);
      remoteFetchLeaderboard().then(function (rows) {
        loading.remove();
        if (!rows.length) {
          wrap.appendChild(el("p", "wt-lead", "共有ランキングを取得できませんでした。"));
          // fallback
          var local = buildLeaderboardRows().map(function (r) {
            return { name: r.name, total: r.total, word: r.word, grammar: r.grammar };
          });
          if (local.length) renderRankList(wrap, local, meName);
          return;
        }
        renderRankList(wrap, rows, meName);
      });
    } else {
      var local = buildLeaderboardRows().map(function (r) {
        return { name: r.name, total: r.total, word: r.word, grammar: r.grammar };
      });
      if (local.length) renderRankList(wrap, local, meName);
    }
    if (hasText(gr.allDoneBodyJa)) {
      card.appendChild(el("p", "wt-lead", String(gr.allDoneBodyJa)));
    }
    root.appendChild(card);
  }

  function renderDone(conf) {
    if (!root) return;
    emptyRoot();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    const need = clearsNeededForAudio(lesson);
    let justUnlockedAudio = false;
    consecutivePerfectClears += 1;
    if (!audioQuizUnlocked && consecutivePerfectClears >= need) {
      audioQuizUnlocked = true;
      justUnlockedAudio = true;
    }
    gameSessionTotal += gameRoundScore;
    gameSessionWordTotal += gameRoundScore;
    var prevHi = readHighScore();
    var isNewRecord = gameRoundScore > prevHi && gameRoundScore > 0;
    writeHighScoreIfBetter(gameRoundScore);
    var hiNow = readHighScore();
    const card = el("div", "wt-card wt-done");
    const t = el("p", "wt-done__title", "すべて正解です！");
    var doneSubText = String(conf.doneSubJa || "");
    if (typeof conf.audioQuizLapsTotal === "number") {
      doneSubText = doneSubText.replace(
        /\{laps\}/g,
        String(conf.audioQuizLapsTotal)
      );
    }
    const sub = el("p", "wt-done__text", doneSubText);
    card.appendChild(t);
    var sCopy = getScoreCopy();
    var scoreBox = el("div", "wt-score-card");
    scoreBox.appendChild(el("p", "wt-score-card__label", sCopy.roundTitleJa));
    scoreBox.appendChild(
      el("p", "wt-score-card__value", String(gameRoundScore))
    );
    scoreBox.appendChild(
      el(
        "p",
        "wt-score-card__combo",
        sCopy.comboMaxJa + " ×" + gameQuizStreakRoundMax
      )
    );
    scoreBox.appendChild(
      el(
        "p",
        "wt-score-card__session",
        sCopy.sessionJa +
          " " +
          gameSessionTotal +
          " pt（単語 " +
          gameSessionWordTotal +
          " / 文法 " +
          gameSessionGrammarTotal +
          "）"
      )
    );
    var bestStr = sCopy.bestJa + " " + hiNow + " pt";
    if (isNewRecord) {
      bestStr += " · " + sCopy.newRecordJa;
    }
    scoreBox.appendChild(el("p", "wt-score-card__best", bestStr));
    if (isNewRecord) {
      scoreBox.classList.add("wt-score-card--new");
    }
    card.appendChild(scoreBox);

    // 音声テスト（1周）終了後は、すぐ文法テストへ（一方通行）
    if (conf && conf.audioQuiz === true) {
      (conf.words || []).forEach((w) => sessionUsedWordKeys.add(normKey(w.word)));
      root.appendChild(card);
      window.setTimeout(function () {
        listeningStreak = 0;
        listeningCleared = true;
        renderGrammarReorder(0);
      }, 350);
      return;
    }
    if (justUnlockedAudio) {
      const unlockMsg = String(conf.doneAudioUnlockJa || "").replace(
        /\{n\}/g,
        String(need)
      );
      card.appendChild(el("p", "wt-done__unlock", unlockMsg));
    }
    card.appendChild(sub);
    if (!audioQuizUnlocked && need > 0) {
      const left = need - consecutivePerfectClears;
      if (left > 0) {
        card.appendChild(
          el(
            "p",
            "wt-done__streak",
            "音声テストまで あと " + left + " 回（連続ですべて正解すると解放されます）"
          )
        );
      }
    }
    const btnNext = el(
      "button",
      "wt-btn wt-btn--primary",
      conf.doneNextRoundJa
    );
    btnNext.type = "button";
    btnNext.addEventListener("click", () => {
      (conf.words || []).forEach((w) =>
        sessionUsedWordKeys.add(normKey(w.word))
      );
      const next = sprintConfig(lesson);
      if (next) renderWelcome(next, { shortIntro: true });
      else
        showError(
          "次の問題セットを用意できませんでした。最初からやり直してください。"
        );
    });
    const btnFull = el(
      "button",
      "wt-btn wt-btn--ghost",
      conf.doneRestartFullJa
    );
    btnFull.type = "button";
    btnFull.addEventListener("click", () => {
      consecutivePerfectClears = 0;
      audioQuizUnlocked = false;
      listeningStreak = 0;
      listeningCleared = false;
      gameSessionTotal = 0;
      gameSessionWordTotal = 0;
      gameSessionGrammarTotal = 0;
      playerLocked = false;
      sessionUsedWordKeys.clear();
      const next = sprintConfig(lesson);
      if (next) renderWelcome(next, { shortIntro: false });
    });
    const actions = el("div", "wt-actions");
    actions.appendChild(btnNext);
    actions.appendChild(btnFull);
    card.appendChild(actions);
    root.appendChild(card);
  }

  /** iPhone / iPad / iPadOS（デスクトップ表示も含む） */
  function isLikelyIOSBrowser() {
    var ua = navigator.userAgent || "";
    if (/iPad|iPhone|iPod/i.test(ua)) return true;
    if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
      return true;
    return false;
  }

  /** iPad などでは Service Worker まわりで よみこみがとまることが多いので オフにする */
  function shouldSkipServiceWorker() {
    if (new URLSearchParams(location.search).has("nosw")) return true;
    const h = location.hostname;
    if (h === "localhost" || h === "127.0.0.1") return false;
    if (isLikelyIOSBrowser()) return true;
    if (h.endsWith(".trycloudflare.com")) return true;
    if (h.endsWith(".local")) return true;
    var p =
      /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
    if (!p.test(h)) return false;
    var parts = h.split(".").map(Number);
    var a = parts[0];
    var b = parts[1];
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }

  /** iOS Safari で getRegistrations が かえってこず「読み込み中」のままになることがあるので かんげんする */
  function clearStaleServiceWorkerForLan() {
    return (async function () {
      try {
        var regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          regs.map(function (r) {
            return r.unregister();
          })
        );
        if ("caches" in window) {
          var keys = await caches.keys();
          await Promise.all(
            keys
              .filter(function (k) {
                return k.indexOf("wordtest") !== -1;
              })
              .map(function (k) {
                return caches.delete(k);
              })
          );
        }
      } catch (e) {
        /* ignore */
      }
    })();
  }

  function lessonFetchUrl() {
    var base = lessonUrl();
    var sep = base.indexOf("?") >= 0 ? "&" : "?";
    return base + sep + "t=" + Date.now();
  }

  /** fetch が だんまりしたり SW にさえぎられたりするので XHR に つぎぐちをつける */
  async function loadLessonJson() {
    var url = lessonFetchUrl();
    var ac = new AbortController();
    var tid = window.setTimeout(function () {
      ac.abort();
    }, 10000);
    try {
      var res = await fetch(url, { cache: "no-store", signal: ac.signal });
      window.clearTimeout(tid);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (e1) {
      window.clearTimeout(tid);
      return await new Promise(function (resolve, reject) {
        var x = new XMLHttpRequest();
        x.open("GET", url, true);
        x.timeout = 15000;
        x.onload = function () {
          if (x.status < 200 || x.status >= 300) {
            reject(new Error("HTTP " + x.status));
            return;
          }
          try {
            resolve(JSON.parse(x.responseText));
          } catch (e2) {
            reject(e2);
          }
        };
        x.onerror = function () {
          reject(new Error("xhr"));
        };
        x.ontimeout = function () {
          reject(new Error("timeout"));
        };
        x.send();
      });
    }
  }

  async function start() {
    if (location.protocol === "file:") {
      showError(
        "index.html をダブルクリックで開いています（file://）。教材はサーバー経由で開いてください。ターミナルで english-lesson-pwa に移動し、python3 serve_lan.py --open を実行してから、表示される http://127.0.0.1:8765/ を開いてください（手順は OPEN.txt）。"
      );
      return;
    }
    var slowTimer = window.setTimeout(function () {
      if (loadingEl && document.body.contains(loadingEl)) {
        showError(
          "読み込みに時間がかかっています。Mac で python3 serve_lan.py を動かしているか、URL が http://192.168.〜 または https://（Netlify など）になっているか確認してください。止まり続けるときは index.html?nosw=1 を試してください。"
        );
      }
    }, 18000);

    function cancelSlowTimer() {
      window.clearTimeout(slowTimer);
    }

    if ("serviceWorker" in navigator && shouldSkipServiceWorker()) {
      var swP = clearStaleServiceWorkerForLan();
      if (!isLikelyIOSBrowser()) {
        await Promise.race([
          swP,
          new Promise(function (resolve) {
            window.setTimeout(resolve, 2500);
          }),
        ]);
      }
      /* iOS: getRegistrations が かえらないことがあるので まちを しない */
    }
    cancelSlowTimer();
    // まず 中1/中2/中3/英会話 → 教材を選ぶ
    var idx = await loadLessonsIndex();
    var saved = readSelectedLessonPath();
    if (saved) currentLessonPath = saved;
    renderTrackSelect(idx);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  if (
    "serviceWorker" in navigator &&
    location.protocol !== "file:" &&
    !shouldSkipServiceWorker()
  ) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register(new URL("sw.js", document.baseURI).href, {
          updateViaCache: "none",
        })
        .catch(function () {});
    });
  }
})();
