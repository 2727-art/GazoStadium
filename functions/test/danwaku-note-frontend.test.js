"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const frontendSource = fs.readFileSync(path.join(root, "danwaku-note.js"), "utf8");
const cssSource = fs.readFileSync(path.join(root, "danwaku-note.css"), "utf8");

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("danwaku NOTE uses the canonical callable action contract", () => {
  const actionBlock = sourceBetween(
    frontendSource,
    "const DANWAKU_ACTIONS = Object.freeze({",
    "const MUTATION_ACTIONS",
  );
  const actions = [...actionBlock.matchAll(/:\s*"([a-z_]+)"/g)].map((match) => match[1]);

  assert.deepEqual(actions, [
    "state",
    "create",
    "update",
    "continue",
    "reset",
    "archive",
    "restore",
    "delete",
    "set_public",
    "history",
    "ranking",
  ]);
  assert.match(frontendSource, /httpsCallable\(functions, "danwakuNoteAction"\)/);
  assert.doesNotMatch(frontendSource, /"(?:create|update|continue|reset|archive|restore|delete)_note"/);
});

test("every mutation carries one Web Crypto operationId within the backend bounds", () => {
  const operationIdSource = sourceBetween(
    frontendSource,
    "function createOperationId()",
    "function isLifecycleCurrent",
  );
  const createOperationId = Function("window", `${operationIdSource}; return createOperationId;`)({
    crypto: {
      randomUUID: () => "12345678-1234-4abc-8def-1234567890ab",
    },
  });
  const operationId = createOperationId();

  assert.equal(operationId, "op_1234567812344abc8def1234567890ab");
  assert.ok(operationId.length >= 16 && operationId.length <= 80);
  assert.match(operationId, /^[A-Za-z0-9_-]+$/);

  const mutationSource = sourceBetween(
    frontendSource,
    "async function runMutation",
    "function normalizeHistoryEvent",
  );
  assert.equal((mutationSource.match(/createOperationId\(\)/g) || []).length, 1);
  assert.match(mutationSource, /const operationId = createOperationId\(\)/);
  assert.match(mutationSource, /callMutationWithRetry\(action, payload, operationId\)/);
  assert.match(mutationSource, /MUTATION_ACTIONS\.has\(action\)/);

  const retrySource = sourceBetween(
    frontendSource,
    "function mutationErrorIsRetryable",
    "async function refreshState",
  );
  assert.match(retrySource, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/);
  assert.match(retrySource, /callDanwakuAction\(action, \{ \.\.\.payload, operationId \}\)/);
  assert.match(frontendSource, /new Set\(\["unavailable", "deadline-exceeded", "internal"\]\)/);
  assert.doesNotMatch(retrySource, /createOperationId\(/);
});

test("note normalization accepts noteId and enforces one server day action", () => {
  const helperSource = [
    sourceBetween(frontendSource, "function isRecord", "function normalizeText"),
    sourceBetween(frontendSource, "function normalizeText", "function nonnegativeInteger"),
    sourceBetween(frontendSource, "function nonnegativeInteger", "function normalizeDayKey"),
    sourceBetween(frontendSource, "function normalizeDayKey", "function normalizeNote"),
    sourceBetween(frontendSource, "function normalizeNote", "function normalizeProfile"),
  ].join("\n");
  const normalizeNote = Function(`
    const NOTE_TITLE_MAX_LENGTH = 30;
    const NOTE_COMMITMENT_MAX_LENGTH = 100;
    const SAFE_NOTE_ID_PATTERN = /^[^\\u0000-\\u001f\\u007f.#$\\[\\]\\/]{1,128}$/;
    ${helperSource}
    return normalizeNote;
  `)();
  const base = {
    noteId: "note-safe",
    title: "夜更かし",
    status: "active",
    currentDays: 4,
    bestDays: 7,
    lastContinueDayKey: "2026-08-04",
    lastResetDayKey: "2026-08-03",
  };

  assert.equal(normalizeNote(base, "2026-08-05").id, "note-safe");
  assert.equal(normalizeNote(base, "2026-08-05").canContinueToday, true);
  assert.equal(normalizeNote(base, "2026-08-05").canResetToday, true);
  assert.equal(normalizeNote({ ...base, lastContinueDayKey: "2026-08-05" }, "2026-08-05").canContinueToday, false);
  const resetToday = normalizeNote({ ...base, lastResetDayKey: "2026-08-05" }, "2026-08-05");
  assert.equal(resetToday.canContinueToday, false);
  assert.equal(resetToday.canResetToday, false);
  assert.equal(normalizeNote({ ...base, currentDays: 0 }, "2026-08-05").canResetToday, false);
});

test("text limits count Unicode code points without splitting emoji", () => {
  const unicodeHelpers = sourceBetween(
    frontendSource,
    "function normalizeNfcText",
    "function nonnegativeInteger",
  );
  const helpers = Function(`${unicodeHelpers}; return { normalizeText, codePointLength, truncateCodePoints };`)();
  const noodles = "🍜".repeat(31);
  const truncated = helpers.truncateCodePoints(noodles, 30);

  assert.equal(helpers.codePointLength(truncated), 30);
  assert.equal(truncated, "🍜".repeat(30));
  assert.equal(helpers.normalizeText("e\u0301", 1), "é");
  assert.doesNotMatch(frontendSource, /maxlength="\$\{NOTE_(?:TITLE|COMMITMENT)_MAX_LENGTH\}"/);
  assert.match(frontendSource, /codePointLength\(draft\.title\) > NOTE_TITLE_MAX_LENGTH/);
  assert.match(frontendSource, /codePointLength\(draft\.commitment\) > NOTE_COMMITMENT_MAX_LENGTH/);
  assert.match(frontendSource, /ONE_LINE_CONTROL_PATTERN\.test\(draft\.title\)/);
  assert.match(frontendSource, /MULTILINE_CONTROL_PATTERN\.test\(draft\.commitment\)/);
});

test("achievement collection uses the permanent cross-NOTE maximum", () => {
  const profileNormalizer = sourceBetween(
    frontendSource,
    "function normalizeProfile",
    "function normalizeRankingEntry",
  );
  const achievementRenderer = sourceBetween(
    frontendSource,
    "function renderAchievementPath",
    "function historyEventPresentation",
  );
  const detailRenderer = sourceBetween(
    frontendSource,
    "function renderDetail",
    "function renderEditor",
  );

  assert.match(profileNormalizer, /highestEverDays: nonnegativeInteger\(source\.highestEverDays\)/);
  assert.match(achievementRenderer, /const highestEverDays = state\.profile\.highestEverDays/);
  assert.match(achievementRenderer, /const unlocked = highestEverDays >= achievement\.days/);
  assert.doesNotMatch(achievementRenderer, /note\.bestDays/);
  assert.match(detailRenderer, /nextAchievement\(note\.bestDays\)/);
  assert.match(frontendSource, /全NOTE共通・永続最高/);
  assert.match(frontendSource, /THIS NOTE \/ NEXT MILESTONE/);
});

test("day boundary scheduling uses server time instead of the device wall clock", () => {
  const scheduler = sourceBetween(
    frontendSource,
    "function scheduleBoundaryRefresh",
    "function setDanwakuChrome",
  );

  assert.match(scheduler, /state\.nextBoundaryAt - state\.serverNow - elapsedSinceServerState/);
  assert.doesNotMatch(scheduler, /state\.nextBoundaryAt - Date\.now\(\)/);
  assert.match(frontendSource, /state\.serverStateReceivedAt = Date\.now\(\)/);
});

test("history reads canonical events and backend event types", () => {
  const historyNormalizer = sourceBetween(
    frontendSource,
    "function normalizeHistoryEvent",
    "async function loadHistory",
  );
  const historyLoader = sourceBetween(
    frontendSource,
    "async function loadHistory",
    "async function loadRanking",
  );

  assert.match(historyNormalizer, /\["create", "continue", "reset", "archive", "restore", "update", "set_public"\]/);
  assert.match(historyNormalizer, /value\.afterDays \?\? value\.days \?\? value\.currentDays/);
  assert.match(historyLoader, /Array\.isArray\(source\.events\)/);
  assert.match(historyLoader, /Array\.isArray\(payload\.events\)/);
  assert.match(frontendSource, /event\.type === "set_public"/);
});

test("public ranking keeps duplicate valid rows and rejects zero-day rows without identifiers", () => {
  const entrySource = sourceBetween(
    frontendSource,
    "function normalizeRankingEntry",
    "function normalizeRankingEntries",
  );
  const entriesSource = sourceBetween(
    frontendSource,
    "function normalizeRankingEntries",
    "function normalizeRanking(value)",
  );
  const normalizeRankingEntries = Function(`
    const NOTE_TITLE_MAX_LENGTH = 30;
    const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
    const normalizeText = (value, maximum) => String(value ?? "").trim().slice(0, maximum);
    const nonnegativeInteger = (value, maximum = Number.MAX_SAFE_INTEGER) => {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0) return 0;
      return Math.min(maximum, Math.floor(number));
    };
    ${entrySource}
    ${entriesSource}
    return normalizeRankingEntries;
  `)();
  const rows = normalizeRankingEntries([
    { rank: 1, name: "同じ名前", currentDays: 7 },
    { rank: 1, name: "同じ名前", currentDays: 7 },
    { rank: 3, name: "はじめの灯り", currentDays: 0 },
  ]);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((entry) => entry.days), [7, 7]);
  assert.deepEqual(Object.keys(rows[0]), ["rank", "name", "days", "title", "isViewer"]);
  assert.doesNotMatch(entrySource, /\b(?:uid|entryId)\b|value\.id/);
  assert.doesNotMatch(entriesSource, /new Set|seen\.has|filter\([^)]*key/);
  assert.doesNotMatch(frontendSource, /\buid\b/i);
});

test("public settings, ranking fetch, and destructive confirmations match the privacy contract", () => {
  const settingsSource = sourceBetween(
    frontendSource,
    "function submitPublicSettings",
    "function bindEvents",
  );
  const continueHandler = sourceBetween(
    frontendSource,
    'document.querySelectorAll("[data-danwaku-continue]")',
    'document.querySelectorAll("[data-danwaku-reset-open]")',
  );

  assert.match(settingsSource, /noteId: validPublicNoteId/);
  assert.match(settingsSource, /rankingVisible:/);
  assert.match(settingsSource, /matchVisible:/);
  assert.match(settingsSource, /shareTitle:/);
  assert.match(frontendSource, /公開名と日数を表示/);
  assert.match(frontendSource, /対戦相手へは日数だけを表示/);
  assert.match(frontendSource, /「自分との約束」は常に非公開です/);
  assert.match(frontendSource, /NOTE名だけを追加表示/);
  assert.match(frontendSource, /「自分との約束」は公開されません/);
  assert.match(frontendSource, /RATE、AnjuPay、マッチング優遇、報酬には使用しません/);
  assert.match(frontendSource, /NOTE自由文と履歴は削除され、元に戻せません/);
  assert.match(frontendSource, /獲得済み実績はコレクションに残ります/);
  assert.match(frontendSource, /callDanwakuAction\(DANWAKU_ACTIONS\.RANKING\)/);
  assert.doesNotMatch(continueHandler, /currentDays\s*(?:\+\+|\+=|=)/);
  assert.doesNotMatch(frontendSource, /localStorage|sessionStorage/);
});

test("mutation toasts reflect backend outcomes instead of claiming every request succeeded", () => {
  const outcomeSource = sourceBetween(
    frontendSource,
    "function mutationOutcomeMessage",
    "async function runMutation",
  );
  const mutationOutcomeMessage = Function(`${outcomeSource}; return mutationOutcomeMessage;`)();
  const success = "成功したという文言";

  assert.equal(mutationOutcomeMessage("continue", "recorded", success), success);
  assert.equal(mutationOutcomeMessage("continue", "already-recorded", success), "本日の断惑継続はすでに記録済みです。");
  assert.match(mutationOutcomeMessage("continue", "reset-today", success), /一区切り/);
  assert.equal(mutationOutcomeMessage("reset", "already-zero", success), "現在の断惑記録はすでに0日です。");
  assert.match(mutationOutcomeMessage("reset", "already-reset", success), /すでに一区切り/);
  assert.match(mutationOutcomeMessage("archive", "already-archived", success), /すでに/);
  assert.match(mutationOutcomeMessage("restore", "already-active", success), /すでに/);
  assert.equal(mutationOutcomeMessage("update", "unchanged", success), "NOTEの表記に変更はありません。");
  assert.doesNotMatch(mutationOutcomeMessage("continue", "no-op", success), /成功したという文言/);
  assert.doesNotMatch(mutationOutcomeMessage("continue", "unknown", success), /成功したという文言/);
  assert.match(frontendSource, /mutationOutcomeMessage\(action, outcome, successMessage\)/);
});

test("standalone lifecycle and responsive CSS are wired without existing-file coupling", () => {
  assert.match(frontendSource, /window\.HariaiDanwakuNote = Object\.freeze\(\{/);
  assert.match(frontendSource, /start,/);
  assert.match(frontendSource, /isActive,/);
  assert.match(frontendSource, /requestHome,/);
  assert.match(frontendSource, /hariai-danwaku-note-ready/);
  assert.match(frontendSource, /signInAnonymously\(auth\)/);
  assert.match(frontendSource, /function escapeHtml/);

  for (const width of [900, 760, 480, 390, 340]) {
    assert.match(cssSource, new RegExp(`@media \\(max-width: ${width}px\\)`));
  }
  assert.match(cssSource, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(cssSource, /\.danwaku-note-commitment\s*\{[\s\S]*?white-space:\s*pre-wrap/);
  assert.match(cssSource, /\.danwaku-detail-copy > p\s*\{[\s\S]*?white-space:\s*pre-wrap/);
  assert.match(cssSource, /^\.danwaku-screen\s*\{/m);
  assert.doesNotMatch(cssSource, /^(?:body|html|:root|#app|\*)\s*\{/m);
});
