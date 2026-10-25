// This record detects lost sessions. It is NOT a credential or proof of ownership.
export const AUTH_SESSION_RECORD_KEY = "hariai-auth-session-v1";
export const AUTH_SESSION_LOCK = "hariai-auth-session-v1";

function sessionError(code, message) {
  return Object.assign(new Error(message), { code: `hariai-auth/${code}` });
}

export function createAuthSessionController({
  auth,
  storage,
  configurePersistence,
  signInAnonymous,
  withLock = (operation) => operation(),
  now = () => Date.now(),
}) {
  let inFlight = null;
  let transition = null;
  let acceptedUid = "";

  function readRecord() {
    try {
      const raw = storage().getItem(AUTH_SESSION_RECORD_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw);
      if (value?.version !== 1 || typeof value.uid !== "string"
          || (!value.uid && value.pending !== true)) throw new Error("invalid record");
      return value;
    } catch {
      throw sessionError("storage-unavailable", "ログイン情報の保存領域を確認できません。サイトデータを削除せず、ブラウザの設定を確認してから再読み込みしてください。");
    }
  }

  function writeRecord(value) {
    try {
      const encoded = JSON.stringify({ ...value, version: 1, updatedAt: now() });
      storage().setItem(AUTH_SESSION_RECORD_KEY, encoded);
      if (storage().getItem(AUTH_SESSION_RECORD_KEY) !== encoded) throw new Error("storage write failed");
    } catch {
      throw sessionError("storage-unavailable", "ログイン情報を端末に保存できません。サイトデータを削除せず、保存できる状態にしてから再読み込みしてください。");
    }
  }

  function recoveryError() {
    return sessionError("recovery-required", "以前のログイン情報を確認できないため、新しいゲストの自動作成を停止しました。以前と同じURLを開くか、Google連携・引き継ぎで復元してください。");
  }

  function acceptUser(user, { explicit = false, previous = readRecord() } = {}) {
    if (!user?.uid || auth.currentUser?.uid !== user.uid) throw recoveryError();
    if (!explicit && previous?.uid && previous.uid !== user.uid) throw recoveryError();
    // Older clients have no record: adopt their restored identity, never replace it.
    if (!previous || previous.uid !== user.uid || previous.pending) {
      writeRecord({ uid: user.uid, previousUid: previous?.uid || previous?.previousUid || "" });
    }
    acceptedUid = user.uid;
    return user;
  }

  function assertCurrentUser() {
    const user = auth.currentUser;
    const record = readRecord();
    if (transition || !user?.uid || (record?.uid && record.uid !== user.uid)
        || (acceptedUid && acceptedUid !== user.uid)) throw recoveryError();
    return user;
  }

  async function resolveUser({ explicitNewGuest = false } = {}) {
    // A network/storage failure is never interpreted as "first visit".
    await auth.authStateReady();
    if (transition) await transition;
    return withLock(async () => {
      await auth.authStateReady();
      if (transition) await transition;
      const previous = readRecord();
      const user = auth.currentUser;
      if (user) {
        // An explicit recovery step may adopt a valid identity already restored
        // by another tab. It never signs out or deletes a Firebase user.
        if (!explicitNewGuest && previous?.uid && previous.uid !== user.uid) throw recoveryError();
        if (!explicitNewGuest && acceptedUid && acceptedUid !== user.uid && previous?.uid !== user.uid) throw recoveryError();
        await configurePersistence();
        return acceptUser(auth.currentUser, { explicit: explicitNewGuest, previous });
      }
      if (!explicitNewGuest && (previous || acceptedUid)) throw recoveryError();
      await configurePersistence();
      // Another tab may have restored a session while persistence was changing.
      if (auth.currentUser) return acceptUser(auth.currentUser, { explicit: explicitNewGuest });
      if (!explicitNewGuest && readRecord()) throw recoveryError();
      // Reserve before the network request. If it fails ambiguously, do not
      // silently create yet another identity on the next attempt/page load.
      writeRecord({ uid: previous?.uid || "", previousUid: previous?.previousUid || "", pending: true });
      const credential = await signInAnonymous();
      return acceptUser(credential.user, { explicit: true, previous });
    });
  }

  function ensureUser(options = {}) {
    if (!inFlight) {
      const request = resolveUser(options);
      inFlight = request.finally(() => { inFlight = null; });
    }
    return inFlight;
  }

  function runAccountTransition(operation) {
    if (transition || inFlight) {
      return Promise.reject(sessionError("busy", "ログイン情報を確認中です。完了してからもう一度お試しください。"));
    }
    // Call the popup operation synchronously from the click handler so browser
    // user activation is retained. Persist the new UID only after success.
    let previous;
    let operationPromise;
    try {
      previous = readRecord();
      operationPromise = operation();
    } catch (error) {
      return Promise.reject(error);
    }
    transition = Promise.resolve(operationPromise).then((result) => {
      acceptUser(result.user, { explicit: true, previous });
      return result;
    }).finally(() => { transition = null; });
    return transition;
  }

  return Object.freeze({ ensureUser, assertCurrentUser, runAccountTransition, readRecord });
}
