# お貢ぎ牧場：掲示板は直近7日に動いた管理人だけ（2026-10-22）

## 対応内容

ユーザーの要望: 管理人カードを作って掲示板に載せたまま、管理人も財布もいない放置カードが掲示板に残り続けると、将来むだな読み込みが増える。どこかで削除（非表示）にしたい。

- 掲示板に並ぶのは、直近7日に動いた管理人だけ（ユーザー決定: 7日）。掲示板の問い合わせに `lastActiveAt >= 現在 − 7日` を足し、放置カードは Firestore の条件で外れて読み込みにも数えない。既存の `accepting`＋`lastActiveAt`（降順）のインデックスを使う
- カードは消さない。招待リンクからはこれまでどおり開け、動いた時はそのまま掲示板の一番上に戻る（カードの記録は年齢確認・財布名・実績の数え上げと同じ記録のため、消すと財布としての記録まで壊れる）
- 活動に数えるもの: 受付を始める、今日のひとこと、契約の中の操作に、管理人カードの保存を足した（ユーザー決定: おすすめの設計）。牧場を開く・既読だけは数えない
- 管理人の画面（本人だけ）: サーバーが掲示板に出ていられる期限 `boardUntil` を返す。外れる2日前から「受付中（掲示板に出ています・あと○日で外れます）」と延ばし方を、外れた後は「掲示板に出ていません」と戻り方（今日のひとこと・カードの保存）、招待リンクは開けることを出す（ユーザー決定: おすすめの設計）
- 推薦棚は月ごとに入れ替わるので、7日の条件はかけない

- 実装コミット: `7968766`、確認スクリプト: `751e65d`（origin/main）

## 配信対象

- Functions: `tributeAction` だけ（掲示板の条件、カードの保存を活動に数える、`boardUntil`）
- Hosting / workers.dev: `index.html`、`tribute.js`・`tribute.css`（キャッシュキー `ranch-board-fresh-v1`）、`tribute-core.mjs`（`…-ranch-kidoku-v1-ranch-board-fresh-v1`）。`tribute-share.mjs`（`ranch-kidoku-v1`）・`tribute-deco.mjs`（`ranch-frame-color-v1`）は変更なし。新しいファイルはない
- Firestore ルール・インデックス・Realtime Database ルール・データの書き換え: なし

## 公開前の検証

- `npm --prefix functions run check`（predeploy と同じ）: **2,036件中2,005件成功・失敗0・31スキップ**（エミュレータ専用）
  - 7日ちょうど手前まではまだ並び、過ぎると外れる。ひとこと・カードの保存・申し込みの受理・受付の入れ直しで戻る。招待リンクからは開ける。受付停止中は `boardUntil` が0
  - 7日と2日の値がサーバーと画面で同じ。問い合わせが既存のインデックスの範囲指定であること
  - 管理人の画面の文言（2日前・外れた後・受付停止中や通報で外れている時は出さない・古いサーバーで期限がない時は出さない）
- firebase-tools の `listFiles` で公開対象を数え、128ファイルで、すべて Git 管理のファイルであることを確認（前回の107からの増加は、ほかのセッションが公開済みのスタジアムのファイル）
- 公開前に、本番3経路の `index.html` が `origin/main`（`7b171d8`、スタジアムの公開を含む）と一致し、`tributeAction` が前回のソースハッシュ（`dca3fae…`）のままであることを確認。作業ブランチは `origin/main` から切り、追跡先を持たない
- 見本（幅375px）で、「あと2日で外れます」の案内、外れた後の案内、ひとことを出すと案内が消えて「掲示板に出ています」に戻ることを確認。はみ出し・コンソールのエラーなし

## 本番反映結果

- Functions・push・Hosting はユーザーが手元の PowerShell で実行した（前回のターミナルが終了していたため、再起動したタブで実行）。push は `7b171d8..751e65d`
- `functions:list`: 37関数すべて ACTIVE（nodejs22）。公開前と比べて変わったのは `tributeAction`（`dca3fae…` → `543b1b2f80ff92cae864588216bc79740b12ea6a`）だけ。`expireTributeContracts` は `dca3fae…` のまま
- workers.dev の自動ビルド（Workers Builds: gazostadium）は success（07:36:29Z）
- `node functions/scripts/verify-tribute-board-fresh-release.cjs`（読み取りのみ、07:36:40Z）: 3経路すべてで `index.html`（招待リンクの形で開いた時も）・`tribute.js`・`tribute.css`・`tribute-core.mjs`・`tribute-share.mjs`・`tribute-deco.mjs` が `751e65d` と一致（改行を揃えて比較）。前回までの公開の印（`ranch-kidoku-v1` から `retire-free-table-v1` まで、スタジアムの `my-stadium-v1`・`my-stadium-v1-diorama-v1`）が残り、設計書・設定・ルール・インデックス・サーバーのコード・確認スクリプト・テストが404
- 本番（web.app）の内蔵ブラウザ: 新しいキャッシュキーの `tribute.js`・`tribute.css` と `tribute-core.mjs`（`…-ranch-board-fresh-v1`）、変更のない `tribute-share.mjs`・`tribute-deco.mjs` が読まれた。コンソールには前回までと同じ URL の出ない 403 が1件（自動操作のブラウザ）。牧場を開く操作は本番では行っていない（ページの読み込みだけ）

## 互換性と限界

- 公開した時点で、7日以上動いていない管理人はまとめて掲示板から外れた。その人数は本番のデータを読む必要があり、数えていない
- 本番の HTML は `Cache-Control: max-age=3600` のため、公開前に開いていた人は最大1時間ほど、管理人の画面で7日の案内が出ない（掲示板の絞り込み自体はサーバーで効く）
- 2人での通しの操作、iPhone／Android 実機・Safari での確認は行っていない
