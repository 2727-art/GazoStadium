# マイスタジアム 第1段（2026-10-19）

## 対応内容

ユーザーの要望: 貼り合いスタジアムの1コンテンツとして、AnjuPayを稼げる放置ゲームを入れる。案A「マイスタジアム経営」を、観客は対戦の完走で増え、施設をPayで建てる形で（ユーザー決定）。数値は設計書の初期値のまま（ユーザー決定）。

- 「開業する」を押した時点の正式完走数を記録し、全員が観客0人から始める。開業前の完走は数えない（ユーザー決定）
- 観客は開業後の検証済み1on1（通常型・戦略型）の完走1回で30人。入場者（観客と収容人数の少ない方）が売上を落とし、金庫（12〜24時間）に貯まる。回収は日本時間1日200 Payまで
- 施設はスタンド・売店・金庫の3つをPayで1段ずつ建てる（全部で25,800 Pay、満席で8 Pay/時）。代金は消却
- 詳細は [`STADIUM_DESIGN.md`](../../STADIUM_DESIGN.md)。実装コミット: `a754e75`、リリース記録: `323cae1`（ブランチ `feature/my-stadium`）。PR #2 をユーザーが GitHub でマージ（マージコミット `b19a448`、12:39:05Z）

## 配信対象

- Functions: `stadiumAction`（新規）と `economyAction`（AnjuPay利用履歴を読む時に `details.facility` / `facilityLevel` を落とさないため。`functions/anju-pay-ledger.js` の `sanitizeDetails` を更新した）
- Hosting / workers.dev: `index.html`、`app.js`・`velvet.css`・`account.js`（キャッシュの印の末尾に `-my-stadium-v1`）、新規の `stadium.js`・`stadium.css`・`stadium-core.mjs`（`my-stadium-v1`）
- Firestore ルール・インデックス・Realtime Database ルール: 変更なし（`stadiums/{uid}` は最後の全拒否ルールで閉じている）
- データの移し替え: なし

## 公開前の検証

- `npm --prefix functions run check`（predeploy と同じ）: **2,028件中1,997件成功・失敗0・31スキップ**（エミュレータ専用）
- ローカルの見本 `?stadiumPreview=…` の7つの状態で、開業・建設・回収が計算どおりになること、幅375pxで横にはみ出さないこと、コンソールのエラー0件を確認
- firebase-tools（15.32.1）の `listFiles` で公開対象を数え、110ファイル（前回の107＋`stadium.js`・`stadium.css`・`stadium-core.mjs`）。設計書・Functions のファイルを含まない
- 公開前に、web.app と firebaseapp.com の `index.html` が `origin/main`（`7309508`）と一致することを確認（他のセッションの公開を巻き戻さない）
- 公開前の `functions:list`: 36関数すべて ACTIVE。`stadiumAction` はなし、`economyAction` は `81a2b70c15c8271140837122632b6aeb0395b372`

## 想定外の公開（workers.dev）

- `feature/my-stadium` を push しただけで（`main` は `7309508` のまま）、Workers Builds がこのブランチを本番の workers.dev に出した（チェック「Workers Builds: gazostadium」完了 12:06:22Z）。それまでは `main` だけが本番に出ると思っていた
- その間 workers.dev ではトップに「マイスタジアム」のタイルが出たが、`stadiumAction` が未配備（404）のため、開くと「開けませんでした」の画面になった。データの書き込みはない。web.app と firebaseapp.com は `main` の画面のままだった
- 12:30Z 頃に `stadiumAction` を配備して解消（約24分間）。ロールバックではなく、そのまま公開する方針はユーザーの決定
- 原因は Cloudflare の Workers Builds の設定で、非本番ブランチのビルドの「バージョン コマンド」が `npx wrangler deploy` だった。同じ日にユーザーが設定を変え、「プロダクション」は `main` と `npx wrangler deploy` のまま、「プレビューのベース」の「プレビューブランチのビルド」をオフにした。以後 `main` 以外の push はビルドもデプロイもしない（実際のブランチの push ではまだ確かめていない）。`main` 以外の PR には「Workers Builds」のチェックが付かなくなる

## 本番反映結果

- Functions と Hosting は Claude が `firebase-tools` 15.32.1 で実行した（`deploy --only "functions:stadiumAction,functions:economyAction"`、続けて `deploy --only hosting`）
- `functions:list`: 37関数すべて ACTIVE（nodejs22）。公開前と比べて変わったのは `economyAction`（`81a2b70…` から）と新規の `stadiumAction` だけで、どちらも `18155dbd5ee2e0c14f2ffec61857bde61bb2eeb2`
- `stadiumAction` に認証なしで POST すると 401 `UNAUTHENTICATED`（関数が存在し、認証を求めている）
- Hosting: 110ファイルを公開（新しくアップロードしたのは7ファイル）
- 3経路（web.app・firebaseapp.com・workers.dev）すべてで、`index.html`・`stadium.js`・`stadium.css`・`stadium-core.mjs`・`app.js`・`account.js`・`velvet.css` が `a754e75` と一致（改行を揃えて比較）。`STADIUM_DESIGN.md`・`README.md`・`functions/stadium-rules.js`・`functions/stadium-service.js` は404
- 本番（web.app）の内蔵ブラウザ: トップの「マイスタジアム」から、`stadiumAction` の `get` を通って開業の画面が出た（App Check と匿名ログインを通過）。コンソールのエラーは0件。「開業する」・回収・建設は本番では行っていない（記録を作らないため）
- マージの後: `main`（`b19a448`）の中身は `323cae1` と同じ。workers.dev は `main` から組み直され（12:39:37Z success）、3経路すべてで同じ7ファイルが `origin/main` と一致し、設計書・README・サーバーのコード・リリースの記録は404のまま。`stadiumAction` は認証なしで401

## 互換性と限界

- 本番の HTML は `Cache-Control: max-age=3600` のため、公開前に開いていた人は最大1時間ほどタイルが出ない。読み直せば出る
- エミュレータでの確認（同時に2回回収しても二重にならないこと、ブラウザから `stadiums` を読めないこと）は行っていない。どちらも Firestore のトランザクションと全拒否ルールに任せている
- 本番での開業・回収・建設の通し、iPhone／Android 実機・Safari での確認は行っていない
