"use strict";

// Admin-only local migration transport. OAuth stays in memory and headers.
// ETag compare-and-swap preserves the same optimistic transaction boundary as
// the Admin SDK; a 412 always rereads before evaluating the callback again.
function createMigrationRealtimeRest({ databaseURL, getAccessToken, fetchImpl = fetch, timeoutMs = 30_000 }) {
  const baseURL = new URL(databaseURL);
  function snapshot(path, value) {
    return { key: path.split("/").filter(Boolean).at(-1) || null,
      val: () => structuredClone(value), exists: () => value !== null };
  }
  async function request(path, method, value, etag) {
    const token = await getAccessToken();
    if (!token?.access_token) throw new Error("Migration RTDB access token is unavailable.");
    const url = new URL(`${path.split("/").filter(Boolean).map(encodeURIComponent).join("/")}.json`, baseURL);
    const headers = { Authorization: `Bearer ${token.access_token}` };
    if (method === "GET") headers["X-Firebase-ETag"] = "true";
    if (etag) headers["If-Match"] = etag;
    if (method !== "GET") headers["Content-Type"] = "application/json";
    const response = await fetchImpl(url.href, { method, headers,
      ...(method !== "GET" ? { body: JSON.stringify(value) } : {}), signal: AbortSignal.timeout(timeoutMs) });
    if (response.status === 412) return { conflict: true };
    if (!response.ok) {
      const error = new Error("Migration RTDB REST request failed.");
      error.code = `rtdb-http-${response.status}`;
      throw error;
    }
    return { value: await response.json(), etag: response.headers.get("etag") };
  }
  function ref(path = "") {
    return {
      get: async () => snapshot(path, (await request(path, "GET")).value),
      set: async (value) => { await request(path, "PUT", value); },
      update: async (value) => { await request(path, "PATCH", value); },
      remove: async () => { await request(path, "PUT", null); },
      child: (child) => ref(`${path}/${child}`),
      async transaction(update) {
        for (let attempt = 0; attempt < 25; attempt += 1) {
          const current = await request(path, "GET");
          if (!current.etag) throw new Error("Migration RTDB CAS response has no ETag.");
          const next = update(structuredClone(current.value));
          if (next === undefined) return { committed: false, snapshot: snapshot(path, current.value) };
          const result = await request(path, "PUT", next, current.etag);
          if (!result.conflict) return { committed: true, snapshot: snapshot(path, result.value) };
        }
        const error = new Error("Migration RTDB transaction was superseded too often.");
        error.code = "aborted";
        throw error;
      },
    };
  }
  return { ref };
}

module.exports = { createMigrationRealtimeRest };
