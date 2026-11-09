"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
// Generated on every Firebase/Cloudflare deployment so the old-origin wallet
// always uses the same shell and versioned modules as the current application.
const html = fs.readFileSync(path.join(root, "index.html"), "utf8")
  .replace("<head>", '<head>\n    <meta name="robots" content="noindex,follow" />');
fs.writeFileSync(path.join(root, "account-transfer.html"), html);
console.log("Prepared the same-origin account transfer page.");
