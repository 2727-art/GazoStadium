const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const voiceModule = import(pathToFileURL(path.join(root, "strategy-voice-transfer.mjs")).href);

// モノラル16bit PCM の WAV。秒数と標本化周波数だけを変えられる。
function wav(seconds, rate = 22_050) {
  const samples = Math.round(rate * seconds);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let index = 0; index < samples; index += 1) view.setInt16(44 + index * 2, (index % 200) * 50, true);
  return buffer;
}

function channel() {
  const sent = [];
  return { readyState: "open", sent, send(data) { sent.push(data); } };
}

const META = { transferId: "vo_0123456789abcdef", ownerUid: "alice", round: 4, createdAt: 1_790_000_000_000 };

async function sendAndReceive(seconds = 2.5) {
  const { sendStrategyVoice, createIncomingStrategyVoiceTransfer, appendStrategyVoiceChunk, finishIncomingStrategyVoiceTransfer } = await voiceModule;
  const wire = channel();
  const voice = { blob: new Blob([wav(seconds)], { type: "audio/wav" }), duration: seconds };
  const transfer = await sendStrategyVoice(wire, voice, META, { chunkBytes: 16 * 1024 });
  const [start, ...rest] = wire.sent;
  const end = rest.pop();
  const incoming = createIncomingStrategyVoiceTransfer(JSON.parse(start), { expectedOwnerUid: "alice", now: META.createdAt });
  for (const chunk of rest) await appendStrategyVoiceChunk(incoming, chunk);
  const urls = [];
  const clip = await finishIncomingStrategyVoiceTransfer(incoming, JSON.parse(end), { urlApi: { createObjectURL: (blob) => { urls.push(blob); return "blob:voice"; } } });
  return { transfer, wire, start: JSON.parse(start), end: JSON.parse(end), clip, urls };
}

test("a voice travels as start, 16KB chunks and end, and arrives as a battle clip with its round", async () => {
  const { transfer, wire, start, end, clip } = await sendAndReceive(2.5);
  assert.equal(start.type, "strategy-voice-start");
  assert.equal(end.type, "strategy-voice-end");
  assert.equal(start.phase, "battle");
  assert.equal(start.round, 4);
  assert.equal(start.mime, "audio/wav");
  assert.equal(transfer.size, 44 + Math.round(22_050 * 2.5) * 2);
  assert.ok(wire.sent.slice(1, -1).every((chunk) => chunk.byteLength <= 16 * 1024));
  assert.deepEqual(
    { id: clip.id, ownerUid: clip.ownerUid, phase: clip.phase, round: clip.round, url: clip.url },
    { id: META.transferId, ownerUid: "alice", phase: "battle", round: 4, url: "blob:voice" },
  );
  assert.ok(Math.abs(clip.duration - 2.5) < 0.01);
});

test("the start is rejected for the wrong sender, phase, round, size, length or type", async () => {
  const { sendStrategyVoice, createIncomingStrategyVoiceTransfer } = await voiceModule;
  const wire = channel();
  await sendStrategyVoice(wire, { blob: new Blob([wav(1)]), duration: 1 }, META);
  const start = JSON.parse(wire.sent[0]);
  const reject = (changes, options = { expectedOwnerUid: "alice" }) => assert.throws(() => createIncomingStrategyVoiceTransfer({ ...start, ...changes }, options));
  reject({}, { expectedOwnerUid: "mallory" });
  reject({}, {});
  reject({ phase: "review" });
  reject({ round: 0 });
  reject({ round: 31 });
  reject({ size: 480 * 1024 + 1 });
  reject({ duration: 10.2 });
  reject({ duration: 0 });
  reject({ mime: "audio/webm" });
  reject({ type: "strategy-review-asset-start" });
  reject({ transferId: "bad id" });
  assert.throws(() => createIncomingStrategyVoiceTransfer(start, { expectedOwnerUid: "alice", currentTransfer: {} }), /別のボイス/);
});

test("too many bytes, a mismatched end or a short body never become a clip", async () => {
  const { sendStrategyVoice, createIncomingStrategyVoiceTransfer, appendStrategyVoiceChunk, finishIncomingStrategyVoiceTransfer, strategyVoiceEndStatus } = await voiceModule;
  const wire = channel();
  await sendStrategyVoice(wire, { blob: new Blob([wav(1)]), duration: 1 }, META);
  const start = JSON.parse(wire.sent[0]);
  const end = JSON.parse(wire.sent.at(-1));
  const fresh = () => createIncomingStrategyVoiceTransfer(start, { expectedOwnerUid: "alice" });
  const overflow = fresh();
  await assert.rejects(appendStrategyVoiceChunk(overflow, new Uint8Array(start.size + 1)), /申告値を超え/);
  const short = fresh();
  await appendStrategyVoiceChunk(short, wire.sent[1]);
  assert.equal(strategyVoiceEndStatus(short, end), "incomplete");
  await assert.rejects(finishIncomingStrategyVoiceTransfer(short, end), /完了していません/);
  const mismatched = fresh();
  for (const chunk of wire.sent.slice(1, -1)) await appendStrategyVoiceChunk(mismatched, chunk);
  assert.equal(strategyVoiceEndStatus(mismatched, { ...end, size: end.size - 2 }), "mismatch");
  assert.equal(strategyVoiceEndStatus(null, end), "orphan");
});

test("a body that is not the declared WAV is refused even when the sizes match", async () => {
  const { createIncomingStrategyVoiceTransfer, appendStrategyVoiceChunk, finishIncomingStrategyVoiceTransfer, verifyStrategyVoiceBytes } = await voiceModule;
  const bytes = wav(2);
  assert.throws(() => verifyStrategyVoiceBytes(bytes, 3), /一致しません/);
  assert.throws(() => verifyStrategyVoiceBytes(wav(10.5), 10.5));
  const fake = new Uint8Array(bytes.byteLength).fill(7);
  const start = { type: "strategy-voice-start", ...META, phase: "battle", mime: "audio/wav", size: fake.byteLength, duration: 2 };
  const incoming = createIncomingStrategyVoiceTransfer(start, { expectedOwnerUid: "alice" });
  await appendStrategyVoiceChunk(incoming, fake);
  await assert.rejects(finishIncomingStrategyVoiceTransfer(incoming, { type: "strategy-voice-end", transferId: META.transferId, ownerUid: "alice", size: fake.byteLength, duration: 2 }));
});

test("sending stops on a closed channel, an inactive match or a missing voice, and still closes a started transfer", async () => {
  const { sendStrategyVoice } = await voiceModule;
  const voice = { blob: new Blob([wav(1)]), duration: 1 };
  await assert.rejects(sendStrategyVoice({ readyState: "closed", send() {} }, voice, META), /P2P接続/);
  await assert.rejects(sendStrategyVoice(channel(), null, META), /送るボイス/);
  const wire = channel();
  let calls = 0;
  await assert.rejects(sendStrategyVoice(wire, voice, META, { isActive: () => (calls += 1) < 2 }), /中断/);
  assert.equal(JSON.parse(wire.sent[0]).type, "strategy-voice-start");
  assert.equal(JSON.parse(wire.sent.at(-1)).type, "strategy-voice-end", "the receiver drops the partial voice at the end");
});

test("transfer ids are random and the release clears the url", async () => {
  const { createStrategyVoiceTransferId, releaseStrategyVoiceResources } = await voiceModule;
  const first = createStrategyVoiceTransferId();
  assert.match(first, /^vo_[0-9a-f]{24}$/);
  assert.notEqual(first, createStrategyVoiceTransferId());
  const revoked = [];
  const clips = [{ url: "blob:a", blob: {} }, { url: "blob:b", blob: {} }];
  const held = [...clips];
  releaseStrategyVoiceResources(clips, { urlApi: { revokeObjectURL: (url) => revoked.push(url) } });
  assert.deepEqual(revoked, ["blob:a", "blob:b"]);
  assert.equal(clips.length, 0);
  assert.ok(held.every((clip) => clip.released && clip.url === "" && clip.blob === null));
});
