# お貢ぎ牧場：請求の二重払いの返金（2026-10-26）

## 対応内容

請求の二重払いの不具合（`TRIBUTE_REQUEST_FIX_RELEASE.md`）で、終わった契約2件・7回・合計130 Payが、同じ請求に重ねて払われていた。

ユーザーの決定: 運営から財布へ返す（おすすめの1）。管理人の残高はそのまま（受け取った分から手数料5%が消えた残りが入っている）。

- 財布の持ち主の記録に「運営からの返金」を積む（`tributeProfiles/{uid}.operatorRefundPending`）。契約ごとに一度だけ積む印を残す（`operatorRefundGrants["double-payment-<contractId>"]`）
- 財布は、お貢ぎ牧場の契約の画面の一番上の「返金待ち」から「財布へ受け取る」で受け取る（`claim_refund`、管理口座の返金と同じ仕組み）。管理口座の返金のあと、財布の残高上限に空きがある分だけ受け取り、残りは待ちのまま
- 利用履歴には、別の種類で残す（`tribute_operator_refund`、「お貢ぎ牧場：運営からの返金（請求の二重払い）」）。受け取るたびに1件
- 返金待ちの表示: 「運営からの返金 ○ Pay：請求を二重に払えてしまう不具合があり、同じ請求に重ねて払われた分をお返しします。ご迷惑をおかけしました。」
- 積むスクリプト `functions/scripts/grant-tribute-double-payment-refunds.cjs`（既定は数えるだけ、`--apply` で積む。UID は出さない）

- 実装コミット: `e6cf8a9`、確認スクリプト: `978f4da`（origin/main）。作業フォルダ `.claude/worktrees/ranch-photo-icons`、ブランチ `release/ranch-double-pay-refund`（`origin/main` `e06c157` から、追跡先なし）

## 配信対象

- Functions: `tributeAction` だけ（返金の受け取り）
- Hosting / workers.dev / hariaistadium.com: `index.html`、`tribute.js`・`account.js`（キャッシュキーの末尾 `ranch-double-pay-refund-v1`）。ほかの公開ファイルは変更なし。Hosting は169ファイル
- 本番のデータ: 財布2人の `tributeProfiles` に返金を積んだ（合計130 Pay）。財布の残高は、本人が受け取るまで変わらない

## 公開前の検証

- `npm --prefix functions run check`（predeploy と同じ）: **2,205件中2,173件成功・失敗0・32スキップ**（エミュレータ専用）
  - 返金は利用履歴に別の種類で残り、管理人の利用履歴には何も足さない。残高上限まで40しか入らない時は40だけ受け取り、残り50はあとで受け取れる。受け取るたびに別の利用履歴になる
  - 積むスクリプト: 本番と同じ形のデータで「2件・7回・130 Pay」を数え、数えるだけでは書かない、`--apply` は一度だけ積み、2回目は「積み済み」で何もしない、ほかの欄は変えない、報告に UID が出ない
- 見本（`?tributePreview=hub-refund`、幅375px）で、返金待ちが契約の画面の一番上に、運営からの返金と管理口座の返金を分けて出ることを確認
- 確認スクリプト（公開前）: 本番4経路で違うのは今回のファイル（`tribute.js`・`account.js`）だけ

## 本番反映結果

- Functions・push・Hosting・返金を積むスクリプト（数える → `--apply`）はユーザーが手元の PowerShell で、作業フォルダへ移って `git rev-parse HEAD` が `978f4da…` の時だけ実行する1行の形で実行した。push は `e06c157..978f4da`、Hosting は169ファイル
- `functions:list`: 37関数すべて ACTIVE（nodejs24）。変わったのは `tributeAction` だけ（`856693a70abd550a706396d9000a4015a24d6690` → `3a828657772aa0663e8b06ab97c5a21d5e1be37b`）
- 返金を積むスクリプト（数えるだけ 14:15:00Z、`--apply` 14:20:49Z）: 契約514件、二重払いのあった契約2件・財布2人・余分な支払い7回・合計130 Pay。`--apply` で2件・130 Payを積んだ（積み済み0、記録なし0）
  - `f66265317c5c5aac64fa28c899899f6d2cd30665`: 90 Pay（余分な支払い3回）
  - `f80db4d1bc42304a320b4e83ba1a94076c27418d`: 40 Pay（余分な支払い4回）
- workers.dev の自動ビルド（Workers Builds: gazostadium）は success（14:13:07Z）
- `node functions/scripts/verify-tribute-double-pay-refund-release.cjs`（読み取りのみ、14:22:31Z）: 4経路すべてで `index.html`（そのまま・招待リンクの形・`?open=ranch` の形）と `tribute.js`・`account.js`・`tribute.css`・`app.js`・牧場のモジュール3つ・安心ページがコミット `978f4da` と一致。前回までの公開の印が残り、設計書・設定・サーバーのコード・スクリプト・テストが404
- 本番（web.app）の内蔵ブラウザ（ページの読み込みだけ）: `tribute.js`・`account.js` が新しいキャッシュキーで読まれ、返金待ちの説明と利用履歴の名前が入っていることを確認。コンソールのエラーは0件

## 残っていること

- 返金は受け取り式。該当する財布2人がお貢ぎ牧場を開いて「財布へ受け取る」を押すまで、財布の残高は変わらない
- 本番での受け取りの操作は確認していない（テストと見本で確認）
