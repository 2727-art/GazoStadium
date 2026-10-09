# お貢ぎ牧場：はじめての財布の残高表示の修正（2026-10-09）

## 対応内容

- 2026-10-09 の招待・財布の始め方の公開後、ユーザーが Chrome のシークレットウィンドウで牧場を開いたところ、財布の始め方が「いまの財布：確認中」のまま止まっていた
- 原因: AnjuPay を一度も開いたことがない人には `wallets/{uid}` がなく、購読の結果を「不明」（null）として扱っていた。そのため残高が出ず、デイリーミッションへの近道も出なかった
- 修正: 財布の文書がない時は 0 Pay とする（献上の時にはサーバーが財布を用意する。これまでどおり）。財布の始め方の残高の行は、残高が届いた時にその場で書き換える（`guideBalanceMarkup` と `paintWallet`）
- 同じ確認で、App Check が普段のブラウザでは通ることも確かめられた（牧場の状態を受け取れていた）。内蔵ブラウザでの 403 は自動操作のブラウザへの判定と判断した

- 修正コミット: `5e40c21`、確認スクリプト: `2675e3d`（origin/main）

## 配信対象

- Hosting / workers.dev: `index.html`、`tribute.js`（キャッシュキー `ranch-wallet-v1`。`tribute-core.mjs` の読み込みのキーも同じく更新、中身は変更なし）
- Functions・ルール・インデックス・`tribute.css`・`tribute-share.mjs`: 変更なし

## 公開前の検証

- `node --test test/*.test.js`: **1,987件中1,956件成功・失敗0・31スキップ**（エミュレータ専用）。財布の文書がない時に 0 Pay とデイリーミッションの近道が出ること、残高が届くとチップと案内の行が書き換わり十分な残高では近道が消えることを、購読と描画の関数を取り出して確かめるテストを追加
- firebase-tools の `listFiles` で公開対象を数え、106ファイル（新規なし）
- 公開前に、本番3経路の `index.html` が `origin/main`（`5030ad8`）と一致することを確認

## 本番反映結果

- push と Hosting はユーザーが手元の PowerShell で実行した。push は `5030ad8..2675e3d`、Hosting は106ファイルで「release complete」
- workers.dev の自動ビルドは success（12:19:41Z）
- `functions:list`: 36関数すべて ACTIVE、前回の公開から変わった関数はない
- `node functions/scripts/verify-tribute-wallet-release.cjs`（読み取りのみ）: 3経路すべてで `index.html`（招待リンクの形で開いた時も）・`tribute.js`・`tribute.css`・`tribute-core.mjs`・`tribute-share.mjs` が `2675e3d` と一致し、前回までの公開の印が残り、非公開のファイルとモックが404
- 本番（workers.dev）の内蔵ブラウザで、新しい `tribute.js` が読まれてモジュールが初期化され、App Check の交換（自動操作のブラウザで 403、既知）以外に失敗した読み込みがないことを確認。牧場の中の操作は本番では行っていない

## 互換性と限界

- 本番の HTML は `Cache-Control: max-age=3600` のため、公開前に開いていた人は最大1時間ほど「確認中」の表示のままになりうる（読み直すと直る）
- 2人での通しの操作、iPhone／Android 実機・Safari での確認は行っていない
