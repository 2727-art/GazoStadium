"use strict";
const assert = require("node:assert/strict");
const acorn = require("acorn");

// Execute the shipped URL resolver at its real module location. The browser's
// module base changes during bundling; testing only the source module misses it.
module.exports.builtAvatarUrl = function builtAvatarUrl(source, moduleUrl, avatarId) {
  const ast = acorn.parse(source, { sourceType: "module", ecmaVersion: "latest" });
  const resolver = ast.body.find(node => node.type === "FunctionDeclaration"
    && source.slice(node.start, node.end).includes("/tribute-avatars/avatar-"));
  assert.ok(resolver, "the shipped avatar URL resolver exists");
  const normalizer = resolver.body.body[0].declarations?.[0]?.init;
  assert.equal(normalizer?.type, "CallExpression");
  assert.equal(normalizer.callee.type, "Identifier");
  const body = source.slice(resolver.start, resolver.end).replaceAll("import.meta.url", JSON.stringify(moduleUrl));
  return new Function(normalizer.callee.name, "URL", `return (${body});`)(avatarId, URL);
};
