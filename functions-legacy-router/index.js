"use strict";
const { onRequest } = require("firebase-functions/v2/https");
const { redirectFor } = require("./route.cjs");

exports.legacySiteRedirect = onRequest({
  region: "us-central1", invoker: "public", minInstances: 0, maxInstances: 3,
  memory: "128MiB", cpu: "gcf_gen1", concurrency: 1,
}, (req, res) => {
  // Hosting reserves /__/ itself and serves the retained static files first.
  // Never trust Host or a query parameter as the cross-origin destination.
  const url = new URL(req.originalUrl || req.url, "https://gazostadium.web.app");
  const { status, location } = redirectFor(url);
  res.set("Cache-Control", "private, no-store");
  res.set("X-Content-Type-Options", "nosniff");
  res.redirect(status, location);
});
