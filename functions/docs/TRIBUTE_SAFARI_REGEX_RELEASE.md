# お貢ぎ牧場：iOS 16.3 以前の iPhone で開けない不具合の修正（2026-10-27）

## 経緯

- 2026-10-27 0:08（日本時間）に、利用者から問い合わせが1件あった。内容は次のとおり。
  - iPhone でお貢ぎ牧場を開こうとすると「お貢ぎ牧場を読み込んでいます」のまま止まる。
  - 再読み込みしても開けない。
  - 他の機能はすぐに開ける。
- この表示（`app.js` の `startTribute`）は、牧場のプログラム本体（`tribute.js`）が読み込まれるまでのもの。App Check の確認はその後なので、確認用ブラウザで出ている App Check の403とは関係がない。

## 原因（見当）

- `tribute-core.mjs` の会う約束を止める判定に、正規表現の否定の後読みがあった。「出会う」を通すためのもので、2026-10-01 の公開からある。
- iPhone の Safari が後読みを読めるのは iOS 16.4 から。それより前の Safari では、このファイルが構文エラーになる。読み込む `tribute.js` ごと動かず、`window.HariaiTribute` ができないので、上の表示のまま止まる。
- 画面向けのファイルで後読みを使っていたのは、ここだけだった。そのため他の機能は開ける。問い合わせの症状（iPhone・牧場だけ・再読み込みでも同じ）と一致する。
- 問い合わせた利用者の iOS のバージョンはまだ確かめていない。iOS 16.3 以前の iPhone（iOS 15 までの iPhone 6s・7・初代 SE を含む）では、10月1日から牧場が開けなかったことになる。

## 対応内容

- 判定を後読みなしにした: 「会」の1文字前が「出」でない（または文の始め）かを見る。
  - `test()` だけに使うので、結果はサーバー（後読みのまま）と同じ。
  - サーバーは Node なので変えていない。
- テスト `functions/test/browser-regex-compat.test.js` を足した。
  - リポジトリの直下にある画面向けのファイル（`*.js`・`*.mjs`）に、後読みが1つもないことを確かめる。
  - 会う約束の判定が、10の文でサーバーと同じ結果になることを確かめる（「出会えてよかった」は通し、「やっと出会えた。会おうね」は止める）。

コミットと作業場所:

- 実装: `47e088d`（origin/main）。同じ push で、前回の記録 `f7c1864` も main に入った。
- 作業フォルダ: `.claude/worktrees/ranch-photo-icons`
- ブランチ: `design/ranch-wallet-moves`

## 配信対象

- Functions: 変更なし
- Firestore のルールとインデックス: 変更なし
- Hosting / workers.dev / hariaistadium.com:
  - `index.html`
  - `tribute.js`（キャッシュキーの末尾 `ranch-safari-regex-v1`）
  - `tribute-core.mjs`（`tribute.js` からの読み込みの印の末尾 `ranch-safari-regex-v1`）
- 本番のデータ: 書き込みなし

## 公開前の検証

- `npm --prefix functions run check`: **2,277件中2,244件成功・失敗0・33スキップ**（エミュレータ専用）。
- 見本で、牧場が開き（`window.HariaiTribute` ができる）、スレッドが出ることを確かめた。判定は「会おう」を止め、「出会えた」を通す。
- 確認スクリプト（公開前）: 本番4経路で違うのは `index.html`・`tribute.js`・`tribute-core.mjs` だけ。

## 本番反映結果

- push と Hosting はユーザーが手元の PowerShell で、この順に実行した。
  - どれも作業フォルダへ移り、次の条件を満たす時だけ動く1行の形: `git rev-parse HEAD` が `47e088d…` で、`origin/main` を含む。
  - push は `c7179ab..47e088d`。
- `functions:list`: 37関数のどれも変わっていない。
- workers.dev の自動ビルド（`47e088d`）: 11:35:18Z に成功。
- `node functions/scripts/verify-tribute-safari-regex-release.cjs`（読み取りのみ、11:35:30Z）: 4経路すべてでコミット `47e088d` と一致した。
  - 前回までの公開の印が残っている。
  - 非公開のファイルは404。
- 本番（web.app）の内蔵ブラウザ（ページの読み込みだけ）:
  - 新しいキャッシュキーの `tribute-core.mjs` が読まれ、中に後読みがない。
  - 牧場の本体が読み込まれている（`window.HariaiTribute` がある）。
  - ブラウザにログインの記録は残っていない。
- 古い Safari そのものでの確認はできていない（手元に古い iPhone がない）。

## 残っていること

- 問い合わせた利用者に、再読み込みして開けるかと、iOS のバージョンを確かめてもらう（ユーザーが返信する）。
  - HTML は最大1時間キャッシュされるので、少し時間を置いた方が確実。
