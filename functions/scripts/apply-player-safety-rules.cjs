"use strict";

// Apply the shared contact boundary without reformatting the existing long
// security expressions. This script is idempotent and never deploys anything.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const rulesPath = path.join(root, "database.rules.json");
const disabled = "root.child('online/config/playerSafetyEnabled').val() !== true";

function contactBoundary(roomPath, roomId, mode, first, second) {
  const room = `root.child('${roomPath}/' + ${roomId})`;
  const gate = `root.child('online/contactGates').child(${room}.child('safetyPairId').val())`;
  const grant = `${gate}.child('grants').child(${room}.child('safetyGrantId').val())`;
  return `(${disabled} || (${room}.child('safetyPairId').isString() && ${room}.child('safetyGrantId').isString()`
    + ` && ${gate}.child('initialized').val() === true && ${gate}.child('blocked').val() === false`
    + ` && ${gate}.child('version').val() === ${room}.child('safetyVersion').val()`
    + ` && ${gate}.child('participants').child(auth.uid).val() === true`
    + ` && ${grant}.child('roomId').val() === ${roomId} && ${grant}.child('mode').val() === '${mode}'`
    + ` && ((${grant}.child('firstUid').val() === ${room}.child('${first}').val() && ${grant}.child('secondUid').val() === ${room}.child('${second}').val())`
    + ` || (${grant}.child('secondUid').val() === ${room}.child('${first}').val() && ${grant}.child('firstUid').val() === ${room}.child('${second}').val()))`
    + ` && (${grant}.child('active').val() === true || ${grant}.child('expiresAt').val() > now)))`;
}

const original = fs.readFileSync(rulesPath, "utf8");
const originalRules = JSON.parse(original).rules;
const eol = original.includes("\r\n") ? "\r\n" : "\n";
const stack = [];
let changed = original.split(/\r?\n/).map((line) => {
  const opening = line.match(/^\s*"([^"\\]+)": \{$/);
  if (opening) {
    stack.push(opening[1]);
    const current = stack.slice(1).join("/");
    const ownCollection = current.match(/^online\/(strategyQueue|strategyActive)\/\$uid$/)?.[1];
    if (ownCollection && !originalRules.online[ownCollection].$uid[".read"]) {
      return `${line}${eol}${line.match(/^\s*/)[0]}  ".read": "auth != null && auth.uid === $uid",`;
    }
    return line;
  }
  if (/^\s*\},?$/.test(line)) { stack.pop(); return line; }
  const match = line.match(/^(\s*)"(\.read|\.write)": (.+?)(,?)$/);
  if (!match) return line;
  const rule = JSON.parse(match[3]);
  if (rule === false || typeof rule !== "string" || rule.includes("playerSafetyEnabled")) return line;
  const current = stack.slice(1).join("/");
  let condition = "";
  if (["online/strategyQueue", "online/strategyActive"].includes(current) && match[2] === ".read") condition = disabled;
  if (current.startsWith("online/leaderboardComments/")) condition = disabled;
  if (current === "online/strategyActive/$uid" && match[2] === ".write") condition = `(${disabled} || !newData.exists())`;
  if (current.startsWith("online/strategyOffers/") && match[2] === ".write") condition = `(${disabled} || !newData.exists())`;
  const matchedRoom = current.match(/^online\/(rooms|strategyRooms|valueMarketRooms)\/\$roomId(?:\/(.*))?$/);
  if (matchedRoom) {
    const [, kind, subpath = ""] = matchedRoom;
    const mode = { rooms: "solo", strategyRooms: "strategy", valueMarketRooms: "market" }[kind];
    const terminal = /^(resultClaims|finished)(\/|$)/.test(subpath);
    const initialization = /^(hostUid|guestUid|createdAt|protocolVersion|members|players|status|reunion)(\/|$)/.test(subpath);
    if (match[2] === ".write" && initialization) condition = disabled;
    else if (!terminal || match[2] === ".read") condition = contactBoundary(`online/${kind}`, "$roomId", mode,
      kind === "valueMarketRooms" ? "sellerUid" : "hostUid", kind === "valueMarketRooms" ? "buyerUid" : "guestUid");
  }
  if (current.startsWith("online/strategyChats/")) condition = contactBoundary("online/strategyRooms", "$roomId", "strategy", "hostUid", "guestUid");
  if (/^freeTables\/(sessions|presence|chat|signals)\/\$sessionId(?:\/|$)/.test(current)) {
    condition = contactBoundary("freeTables/sessions", "$sessionId", "free_table", "hostUid", "visitorUid");
  }
  return condition ? `${match[1]}"${match[2]}": ${JSON.stringify(`(${rule}) && ${condition}`)}${match[4]}` : line;
}).join(eol);
const parsed = JSON.parse(changed);
if (!parsed.rules.online.strategyQueue[".indexOn"]) {
  changed = changed.replace(`      "strategyQueue": {${eol}`,
    `      "strategyQueue": {${eol}        ".indexOn": ["lastSeen"],${eol}`);
}
if (!parsed.rules.online.contactGates) {
  const additions = {
    contactGates: { ".read": false, ".write": false },
    strategySafetyReservations: { ".read": false, ".write": false, ".indexOn": ["createdAt"] },
    playerSafetyEvents: { "$uid": { ".read": "auth != null && auth.uid === $uid", ".write": false } },
  };
  const lines = JSON.stringify(additions, null, 2).split("\n").slice(1, -1).map((line) => `    ${line}`);
  changed = changed.replace(`    "online": {${eol}`, `    "online": {${eol}${lines.join(eol)},${eol}`);
}
JSON.parse(changed);
fs.writeFileSync(rulesPath, changed);

const indexesPath = path.join(root, "firestore.indexes.json");
const indexes = JSON.parse(fs.readFileSync(indexesPath, "utf8"));
for (const entry of [
  { collectionGroup: "playerSafetyOutbox", queryScope: "COLLECTION", fields: [
    { fieldPath: "status", order: "ASCENDING" }, { fieldPath: "nextAttemptAt", order: "ASCENDING" },
  ] },
  { collectionGroup: "blocks", queryScope: "COLLECTION", fields: [
    { fieldPath: "active", order: "ASCENDING" }, { fieldPath: "createdAt", order: "DESCENDING" },
  ] },
]) {
  if (!indexes.indexes.some((existing) => JSON.stringify(existing) === JSON.stringify(entry))) indexes.indexes.push(entry);
}
fs.writeFileSync(indexesPath, `${JSON.stringify(indexes, null, 2)}${eol}`);
