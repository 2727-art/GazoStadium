"use strict";

// 本物の Firestore と同じ set の書き方をテストの偽物で再現する。
// - set(value): 文書を丸ごと置き換える。
// - set(value, { merge: true }): 入れ子の地図まで深く混ぜる。value に無い鍵は消えずに残る
//   （地図から鍵を消したつもりでも、merge: true では消えない。2026-10-26 未払いの請求が残った不具合）。
// - set(value, { mergeFields: [...] }): 指定した最上位の欄だけを value の値で丸ごと置き換える。
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function deepMerge(target, source) {
  const out = { ...target };
  for (const [key, value] of Object.entries(source)) {
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? deepMerge(out[key], value) : value;
  }
  return out;
}

function applyFirestoreSet(current, value, options = {}) {
  const existing = isPlainObject(current) ? current : {};
  if (Array.isArray(options?.mergeFields)) {
    const out = { ...existing };
    for (const field of options.mergeFields) {
      if (String(field).includes(".")) throw new Error(`mergeFields with nested paths is not supported here: ${field}`);
      if (Object.prototype.hasOwnProperty.call(value, field)) out[field] = value[field];
      else delete out[field];
    }
    return out;
  }
  if (options?.merge) return deepMerge(existing, value);
  return value;
}

module.exports = { applyFirestoreSet, deepMerge };
