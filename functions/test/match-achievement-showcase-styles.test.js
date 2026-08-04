"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("match achievement badges have dedicated desktop and mobile presentation", () => {
  const styles = read("styles.css");
  const strategyStyles = read("strategy.css");

  assert.match(styles, /\.match-achievement-showcase\s*\{/);
  assert.match(styles, /\.match-achievement-showcase\.is-match-found/);
  assert.match(styles, /\.match-achievement-showcase\.is-hud \.achievement-badges\s*\{[\s\S]*?flex-wrap:\s*nowrap/);
  assert.match(styles, /\.hud-player:last-child \.match-achievement-showcase\.is-hud \.achievement-badges/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.match-achievement-showcase\.is-hud \.achievement-badge\s*\{[\s\S]*?flex:\s*0 0 23px/);
  assert.match(styles, /@media \(max-width: 360px\)[\s\S]*?\.match-achievement-showcase\.is-hud \.achievement-badge\s*\{[\s\S]*?flex-basis:\s*18px/);
  assert.match(styles, /@media \(max-width: 340px\)[\s\S]*?\.match-achievement-showcase\.is-hud \.achievement-badge\s*\{[\s\S]*?flex-basis:\s*15px/);
  assert.match(styles, /\.match-achievement-showcase\.is-hud \.achievement-badge small\s*\{[\s\S]*?clip-path:\s*inset\(50%\)/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.match-achievement-showcase\.is-hud \.achievement-badge > span\s*\{[\s\S]*?clip-path:\s*inset\(50%\)/);
  assert.match(styles, /\.match-achievement-showcase\.is-result \.achievement-badges/);

  assert.match(strategyStyles, /\.strategy-identity-card \.match-achievement-showcase\s*\{/);
  assert.match(strategyStyles, /\.strategy-identity-card\.player-2 \.match-achievement-showcase \.achievement-badges/);
  assert.match(strategyStyles, /\.strategy-final-grid article \.match-achievement-showcase/);
});

test("all changed match-showcase assets use the same cache marker", () => {
  const html = read("index.html");
  const marker = "match-achievement-showcase-v1";
  for (const asset of ["styles.css", "strategy.css", "strategy.js", "online.js"]) {
    assert.match(
      html,
      new RegExp(`${asset.replace(".", "\\.")}\\?v=[^\"']*${marker}`),
      `${asset} must use the match showcase cache marker`,
    );
  }
});
