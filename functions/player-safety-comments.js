"use strict";

function createPlayerSafetyComments({ firestore, realtime, HttpsError, playerSafety, now = Date.now }) {
  const id = (value) => {
    const text = String(value || "");
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(text)) throw new HttpsError("invalid-argument", "コメント欄を確認できません。");
    return text;
  };
  const entries = (targetId) => firestore.collection("playerSafetyComments").doc(targetId).collection("entries");
  const get = async (path) => (await realtime.ref(path).get()).val();
  async function identity(entryId) {
    const [uid, profile] = await Promise.all([get(`online/leaderboardOwners/${entryId}`), get(`online/leaderboard/${entryId}`)]);
    return typeof uid === "string" && uid ? { uid, profile } : null;
  }
  async function list(uid, data) {
    const targetId = id(data.targetEntryId); const target = await identity(targetId);
    if (!target?.profile || target.profile.commentsEnabled === false || await playerSafety.isBlocked(uid, target.uid)) {
      return { comments: [] };
    }
    // Legacy rows stay readable only through this server boundary. A canonical
    // tombstone wins over a legacy row, so deletion never resurrects old text.
    const [legacy, current] = await Promise.all([
      realtime.ref(`online/leaderboardComments/${targetId}`).orderByChild("updatedAt").limitToLast(50).get(),
      entries(targetId).orderBy("updatedAt", "desc").limit(50).get(),
    ]);
    const merged = new Map(Object.entries(legacy.val() || {}));
    current.docs.forEach((doc) => merged.set(doc.id, doc.data()));
    const candidates = [...merged].sort((a, b) => Number(b[1].updatedAt) - Number(a[1].updatedAt));
    const comments = [];
    for (const [authorEntryId, row] of candidates) {
      const canonical = await entries(targetId).doc(authorEntryId).get();
      const value = canonical.exists ? canonical.data() : row;
      if (value.deleted || !value.text) continue;
      const author = await identity(authorEntryId);
      if (!author || await playerSafety.isBlocked(uid, author.uid)
          || await playerSafety.isBlocked(target.uid, author.uid)) continue;
      comments.push({ authorEntryId, authorName: String(value.authorName || "プレイヤー").slice(0, 16),
        text: String(value.text).slice(0, 80), updatedAt: Number(value.updatedAt || 0) });
      if (comments.length === 20) break;
    }
    return { comments };
  }
  async function save(uid, data) {
    const targetId = id(data.targetEntryId);
    const authorId = id(await get(`online/leaderboardEntriesByUser/${uid}`));
    const text = String(data.text || "").trim();
    if (!text || text.length > 80 || /[\r\n]/.test(text)) throw new HttpsError("invalid-argument", "コメントは80文字以内の1行で入力してください。");
    if (/(?:https?:\/\/|www\.)/i.test(text)) throw new HttpsError("invalid-argument", "コメントにURLは入力できません。");
    const [target, author] = await Promise.all([identity(targetId), identity(authorId)]);
    if (!target?.profile || !author?.profile || author.uid !== uid || uid === target.uid
        || target.profile.commentsEnabled === false) throw new HttpsError("permission-denied", "このコメント操作は許可されていません。");
    await firestore.runTransaction(async (transaction) => {
      await playerSafety.assertAllowed(uid, target.uid, transaction);
      const profile = await transaction.get(firestore.collection("serverRankingProfiles").doc(target.uid));
      if (profile.exists && (profile.get("enabled") === false || profile.get("commentsEnabled") === false)) {
        throw new HttpsError("failed-precondition", "このコメント欄は現在利用できません。");
      }
      const previous = await transaction.get(entries(targetId).doc(authorId));
      if (previous.exists && now() - Number(previous.get("updatedAt") || 0) < 1500) {
        throw new HttpsError("resource-exhausted", "少し時間をおいて投稿してください。");
      }
      transaction.set(entries(targetId).doc(authorId), { authorUid: uid, targetUid: target.uid,
        authorName: String(author.profile.name).slice(0, 16), text, updatedAt: now(), deleted: false });
    });
    return { saved: true };
  }
  async function remove(uid, data) {
    const targetId = id(data.targetEntryId); const authorId = id(data.authorEntryId);
    const [target, author] = await Promise.all([identity(targetId), identity(authorId)]);
    if (target?.uid !== uid && author?.uid !== uid) throw new HttpsError("permission-denied", "このコメントは削除できません。");
    await entries(targetId).doc(authorId).set({ deleted: true, updatedAt: now() });
    return { deleted: true };
  }
  return { list, save, remove };
}

module.exports = { createPlayerSafetyComments };
