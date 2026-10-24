# お貢ぎ牧場：管理人番付は番付加算の順・1on1で稼ぐ導線（2026-10-24）

## 対応内容

ユーザーの意図: 財布がたくさん貢いで管理人を上位に上げる。そのためには AnjuPay を稼ぐ必要があり、稼ぐには1on1で対戦する。結果としてメインの1on1に人が集まる循環を作りたい。1位にふさわしいのは「毎日500 Pay を貢ぐ財布を確保する管理人」。

- 管理人番付を、今月の番付加算（同じ財布から日本時間1日500 Payまで）の多い順にし、同じなら財布の人数で並べる（ユーザー決定）。以前は財布の人数が先で、財布1人は入場料程度の少額で数えられ（別アカウントで水増ししやすい）、財布が貢いでも順位がほとんど動かなかった（実例: 1位が28人・350 Pay、2位が20人・5,800 Pay）
- 表示は額を先に（「1,850 Pay ・ 財布4人」）、説明の文は「毎日満額を貢ぐ財布を多く抱える管理人が上に来ます」
- 新しい並べ替え用インデックス（`tributeManagerMonths`: `monthKey` 昇順・`rankScore` 降順・`payers` 降順）を足した。古い並べ方のインデックスは、切り替え中に古いサーバーが使うので残した。今月の番付加算はすでに数えてあるので、データの書き換えはない
- 未払いの請求の「Payを貯める」の先頭に「1on1で稼ぐ」を足した（ユーザー決定）。トップの「いますぐ貼り合う」（`#onlineButton`）と同じ入口を開く
- 参考（公開時の報酬の設定）: デイリーミッション4つで300 Pay、毎日のプレイ報酬は10戦で110 Pay・50戦で220 Pay。1日500 Payに届くのはおよそ50戦

- 実装コミット: `e95eebe`、確認スクリプト: `b3b10ca`（origin/main）
- 本体のフォルダはほかのセッションの作業中（`codex/security-hardening-20261023`）のため、前回と同じ作業フォルダ `.claude/worktrees/ranch-photo-icons` に `origin/main` から切ったブランチ `release/ranch-rank-score`（追跡先なし）で作業した

## 配信対象

- Firestore インデックス: 上の1本を追加（削除なし。公開前に本番の34本とファイルを比べ、違いはこの1本だけだった）
- Functions: `tributeAction` だけ（番付の並べ方）
- Hosting / workers.dev: `index.html`、`tribute.js`（キャッシュキー `ranch-rank-score-v1`）。`tribute.css`・`tribute-core.mjs`（`ranch-photo-icons-v1`）、`tribute-share.mjs`・`tribute-deco.mjs` は変更なし。新しいファイルはない（139ファイル）
- Firestore ルール・Realtime Database ルール・データの書き換え: なし

## 公開前の検証

- `npm --prefix functions run check`（predeploy と同じ）: **2,040件中2,009件成功・失敗0・31スキップ**（エミュレータ専用）
  - 1人の財布が毎日500 Pay の管理人が、3人が30 Pay ずつの管理人より上。1日800 Pay は500と数える。番付加算が同じなら財布の多い方が上
  - 「1on1で稼ぐ」が稼ぐ近道の先頭で、`#onlineButton` を開く
- 公開前に、本番3経路の `index.html` が `origin/main`（`da2ae14`）と一致し、37関数すべてが nodejs24 で `tributeAction` が `224adef…`（写真アイコンの版）であることを確認
- 見本（幅375px）で、番付が額の多い順・額が先の表示になること、未払いの請求の「Payを貯める」の先頭に「1on1で稼ぐ」が出ることを確認（本番の対戦の入口が開くため、押してはいない）

## 本番反映結果

- インデックス・Functions・push・Hosting はユーザーが手元の PowerShell で実行した。push は `da2ae14..b3b10ca`
- **取り違え**: 最初は、インデックスと Functions の公開と1回目の push を、作業フォルダではなく本体のフォルダ（`f143b39`）で実行していた。
  - インデックス: 本体のファイルは本番と同じだったため、変化なし（削除もなし）
  - Functions: `tributeAction` が写真アイコンより前の版（`1199347…`、アイコン13〜23を受け付けない）に戻った。作業フォルダから出し直すまでの間に写真アイコンでカードを保存した管理人は、文字の印で保存された可能性がある（本番のデータを読む必要があるため、確かめていない）
  - push: 本体のブランチは main より古く、non-fast-forward で断られた（main には何も入っていない）
  - やり直しは、1行の中で作業フォルダへ移り、`git rev-parse HEAD` が `b3b10ca…` の時だけ実行する形で行った
- インデックス: 番付用の新しいインデックスが READY（Firestore の索引の定義だけを読んで確認）
- `functions:list`: 37関数すべて ACTIVE（nodejs24）。公開前と比べて変わったのは `tributeAction`（`224adef…` → `fba1f0d1def269b26a8c3cda75222efd34c599df`）だけ。写真アイコンに対応した版に戻っている
- workers.dev の自動ビルド（Workers Builds: gazostadium）は success（06:51:16Z）
- `node functions/scripts/verify-tribute-rank-score-release.cjs`（読み取りのみ、06:53:58Z）: 3経路すべてで `index.html`（招待リンクの形で開いた時も）・`tribute.js` が `b3b10ca` と一致し、変更のない `tribute.css`・`tribute-core.mjs`・`tribute-share.mjs`・`tribute-deco.mjs` も一致（改行を揃えて比較）。前回までの公開の印（`ranch-photo-icons-v1` から `retire-free-table-v1` まで、スタジアムの `my-stadium-v1`・`my-stadium-v1-diorama-v1`）が残り、設計書・設定・ルール・インデックス・サーバーのコード・確認スクリプト・テストが404
- 本番（web.app）の内蔵ブラウザ: 新しいキャッシュキーの `tribute.js` が読まれ、その中に「1on1で稼ぐ」と番付の新しい説明が入っていること、トップに `#onlineButton` があることを確認。コンソールには前回までと同じ URL の出ない 403 が1件（自動操作のブラウザ）。牧場を開く操作は本番では行っていない（ページの読み込みだけ）

## 互換性と限界

- 本番の HTML は `Cache-Control: max-age=3600` のため、公開前に開いていた人は最大1時間ほど、番付の説明と稼ぐ近道が古いまま（並び順はサーバーが返すので新しい順）
- 2人での通しの操作、iPhone／Android 実機・Safari での確認は行っていない
