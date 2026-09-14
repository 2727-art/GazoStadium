"use strict";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const safeName = (value) => String(value || "プレイヤー").replace(/[\r\n]/g, " ").slice(0, 40);

function createPlayerSafetyContextResolver({ firestore, realtime, HttpsError,
  resolveNoteOwner = async () => null }) {
  const fs = async (collection, id) => (await firestore.collection(collection).doc(id).get()).data();
  const rt = async (path) => (await realtime.ref(path).get()).val();
  const byField = async (collection, field, id) => {
    const snapshot = await firestore.collection(collection).where(field, "==", id).limit(2).get();
    if (snapshot.size !== 1) return null;
    return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
  };
  async function resolvePublicOwner(kind, id) {
    if (!ID.test(String(id || ""))) return null;
    let value; let uid = ""; let displayName = "";
    switch (kind) {
      case "card":
        [uid, value] = await Promise.all([rt(`online/topMessageOwners/${id}`), rt(`online/topMessages/${id}`)]);
        if (!value) return null;
        displayName = value.name; break;
      case "ranking":
        [uid, value] = await Promise.all([rt(`online/leaderboardOwners/${id}`), rt(`online/leaderboard/${id}`)]);
        if (!uid || !value) {
          value = await byField("serverRankingProfiles", "entryId", id)
            || await byField("serverRankingProfiles", "rateFloorEntryId", id);
          if (value) uid = value.uid || value.id;
        }
        displayName = value?.name; break;
      case "flea":
        value = await fs("anjuPayFleaListings", id);
        uid = value?.sellerUid; displayName = value?.sellerName; break;
      case "flea_seller":
        value = await byField("anjuPayFleaListings", "publicSellerId", id);
        if (!value) {
          const rows = await firestore.collection("anjuPayFleaListings").where("publicSellerId", "==", id).limit(1).get();
          value = rows.docs[0]?.data();
        }
        uid = value?.sellerUid; displayName = value?.sellerName; break;
      case "ai_preset":
        value = await fs("aiTextTrainingPresets", id);
        uid = value?.sellerUid; displayName = value?.sellerName; break;
      case "roulette_pack":
        value = await fs("rouletteTrainingPacks", id);
        uid = value?.sellerUid; displayName = value?.sellerName; break;
      case "ai_seller":
      case "roulette_seller": {
        const collection = kind === "ai_seller" ? "aiTextTrainingSellerStats" : "rouletteTrainingSellerStats";
        value = await byField(collection, "publicSellerId", id);
        uid = value?.sellerUid || value?.uid || value?.id; displayName = value?.sellerName; break;
      }
      case "market_shop":
      case "market_seller":
        value = await byField("valueMarketShops", "publicSellerId", id);
        uid = value?.sellerUid || value?.uid || value?.id; displayName = value?.sellerName || value?.name; break;
      case "free_table":
        value = await fs("freeTablePublicSpaces", id);
        uid = value?.hostUid || value?.uid;
        if (!uid) {
          value = await fs("freeTablePublicMembers", id);
          uid = value?.uid || value?.hostUid;
        }
        displayName = value?.name || value?.card?.name; break;
      case "danwaku": {
        const result = await resolveNoteOwner(id);
        uid = typeof result === "string" ? result : result?.uid;
        value = await fs("danwakuPublicEntries", id);
        displayName = value?.displayName || value?.name; break;
      }
      default: return null;
    }
    if (typeof uid !== "string" || !uid || !value) return null;
    return { uid, name: safeName(displayName), source: kind };
  }
  async function resolveContext(uid, data) {
    const mode = String(data.mode || "public");
    if (mode === "solo_familiar" && ID.test(String(data.familiarId || ""))) {
      const entry = (await firestore.collection("soloFamiliarBooks").doc(uid)
        .collection("familiarEntries").doc(data.familiarId).get()).data();
      return entry?.counterpartUid ? { uid: entry.counterpartUid,
        name: safeName(entry.displayName), source: mode } : null;
    }
    const roomId = String(data.roomId || "");
    if (["solo", "strategy", "market", "free_table"].includes(mode) && ID.test(roomId)) {
      let room;
      if (mode === "market") room = await fs("valueMarketRooms", roomId);
      else if (mode === "free_table") {
        room = await rt(`freeTables/sessions/${roomId}`);
        if (!room) room = await fs("freeTableVisitLedger", roomId);
      } else room = await rt(`online/${mode === "solo" ? "rooms" : "strategyRooms"}/${roomId}`);
      const first = room?.hostUid || room?.sellerUid;
      const second = room?.guestUid || room?.visitorUid || room?.buyerUid;
      if (!room || !first || !second || ![first, second].includes(uid)) {
        throw new HttpsError("not-found", "参加した相手の情報を確認できません。");
      }
      const target = first === uid ? second : first;
      const displayName = room.players?.[target]?.name || room.cards?.[target]?.name
        || room.names?.[target] || (target === room.sellerUid ? room.sellerName : room.buyerName);
      return { uid: target, name: mode === "strategy" ? "対戦相手" : safeName(displayName), source: mode, room, roomId };
    }
    let kind = String(data.kind || "");
    let id = data.publicEntryId;
    if (data.listingId) { kind = "flea"; id = data.listingId; }
    if (data.presetId) { kind = "ai_preset"; id = data.presetId; }
    if (data.packId) { kind = "roulette_pack"; id = data.packId; }
    if (data.publicRoomId || data.publicMemberId) { kind = "free_table"; id = data.publicRoomId || data.publicMemberId; }
    return resolvePublicOwner(kind, String(id || ""));
  }
  return { resolveContext, resolvePublicOwner };
}

module.exports = { createPlayerSafetyContextResolver };
