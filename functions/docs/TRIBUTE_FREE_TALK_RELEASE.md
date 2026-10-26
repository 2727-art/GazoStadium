# お貢ぎ牧場：契約後の会話はお金の判定だけにする（2026-10-26）

## 対応内容

ユーザーの決定（2026-10-24）: 貼り合いスタジアムは、男性の利用者が女の子になりきるロールプレイの遊び（サブカルチャー）で、出会いを目的に使う人はいない。ロールプレイの幅を広げるため、契約後の会話のフィルターは通さない方針にする。現実のお金の判定と、財布が登録した「言われたくない言葉」は残す（ユーザーの選択）。

- 契約後の会話と請求の一言で断るのは、外部決済や現金の言葉（PayPay・振込・ギフト券・現金など）と現実の金額（「○円」など）だけ。牧場の「管理口座」は通す（`contractTextReason`、サーバーと画面で同じ判定）
- 連絡先・SNS の ID・会う約束・個人情報・晒しの言葉は、契約後の会話では止めない
- 管理する側の発言は、財布が登録した「言われたくない言葉」を含むと引き続き断る
- 管理人カード（ペルソナ名・紹介文）・今日のひとこと・財布名は、これまでどおりすべての判定をかける（契約前の人も見るため）
- 入場前の前提の文・ページ下の表記・カード編集の注意書き・X プロフィール欄の説明を合わせて書き換えた。確認のやり直し（`tribute-age-v1` の更新）はしていない
- 設計書（7節）と README を更新した

- 実装コミット: `014c269`（2026-10-24 に作った `aee9975` を、導線の公開後の main `1483329` に載せ直したもの。食い違いはキャッシュキーの行だけ）、確認スクリプト: `7bf0c40`（origin/main）
- 作業フォルダ `.claude/worktrees/ranch-photo-icons`、ブランチ `release/ranch-free-talk-v2`（追跡先なし）

## 配信対象

- Functions: `tributeAction` だけ。公開前に、main のサーバーのコード（`functions/` の docs・test・scripts 以外）が、いま本番の `tributeAction` を出した牧場の修正（`3b84444`）から変わっていないことを確かめ、会話の判定以外が一緒に出ないようにした
- Hosting / workers.dev / hariaistadium.com: `index.html`、`tribute.js`（キャッシュキーの末尾 `ranch-free-talk-v1`）、`tribute-core.mjs`（末尾 `ranch-free-talk-v1`）。`app.js`・`tribute.css`（`ranch-nav-v1`）、`tribute-share.mjs`・`tribute-deco.mjs` は変更なし。Hosting は169ファイル
- Firestore ルールとインデックス・Realtime Database ルール・データ: なし

## 公開前の検証

- `npm --prefix functions run check`（predeploy と同じ）: **2,181件中2,149件成功・失敗0・32スキップ**（エミュレータ専用）
  - 契約後の会話と請求の一言: お金の言葉・現実の金額・言われたくない言葉は断り、連絡先・会う約束・個人情報・晒し・「管理口座」は通る（管理人・財布の両方、サーバーの実行で確認）
  - カード・今日のひとこと・財布名の判定は変わらない。画面とサーバーの判定が一致する
- 手元の見本で、「会いたいな」「管理口座に入れなさい」は画面の判定を通り（見本なので送信はしない）、「PayPayで払え」「3000円分の価値もない」は止まることを確認。導線の公開で入れたスレッドの「次へ」もそのまま動いた。コンソールのエラーは0件
- 確認スクリプト（公開前）: 本番4経路で違うのは今回のファイル（`index.html`・`tribute.js`・`tribute-core.mjs`）だけで、非公開のファイルは404

## 本番反映結果

- Functions・push・Hosting はユーザーが手元の PowerShell で、作業フォルダへ移って `git rev-parse HEAD` が `7bf0c40…` の時だけ実行する1行の形で実行した。push は `1483329..7bf0c40`、Hosting は169ファイル
- `functions:list`: 37関数すべて ACTIVE（nodejs24）。変わったのは `tributeAction` だけ（`10c11ab1d3bd95b73186accc9f91ef67c343ad2c` → `0ff38f3f632663f51f96aefb7cb786b7c2c5119d`）。一緒に出ていた `cleanupPlayerSafety`・`expireTributeContracts`・`playerSafetyAction` は `10c11ab…` のまま、ほかの関数の版も公開前と同じ
- workers.dev の自動ビルド（Workers Builds: gazostadium）は success（11:24:11Z）
- `node functions/scripts/verify-tribute-free-talk-release.cjs`（読み取りのみ、11:26:53Z）: 4経路（web.app・firebaseapp.com・workers.dev・hariaistadium.com）すべてで、`index.html`（そのまま・招待リンクの形・`?open=ranch` の形）と `tribute.js`・`app.js`・`tribute.css`・`tribute-core.mjs`・`tribute-share.mjs`・`tribute-deco.mjs` がコミット `7bf0c40` と一致（改行を揃えて比較）。前回までの公開の印が残り、設計書・README・設定・サーバーのコード・確認スクリプト・テストが404
- 本番（web.app）の内蔵ブラウザ（ページの読み込みだけ）: `tribute.js` と `tribute-core.mjs` が新しいキャッシュキーで読まれ、配信された判定で「会いたいな」「管理口座に入れなさい」「LINE IDおしえて」は通り、「PayPayで払え」は外部決済、「3000円分の価値もない」は現実の金額で止まる。カードの判定では「会いたいな」は引き続き止まる。前提の文が新しい文になり、導線の公開の判定（`?open=ranch`・「次へ」）も残っている。コンソールのエラーは0件。牧場を開く操作は本番では行っていない

## 互換性と限界

- 本番の HTML は `Cache-Control: max-age=3600` のため、公開前に開いていた人は最大1時間ほど、画面の側で古い判定が残る（「会いたい」などが画面で止まる）。読み込み直せば送れる。サーバーは新しい判定
- 請求の一言は、管理人が許可していれば財布の貢ぎ報告の画像に入る。今後は一言に SNS の ID なども書けるので、画像に写ることがある
- すでに入場した人には、新しい前提の文への同意を求めていない
- 本番での牧場の操作（実際の送信、2人での通し、iPhone／Android 実機・Safari）は確認していない
