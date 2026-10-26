# お貢ぎ牧場：出稼ぎ命令（2026-10-26）

## 対応内容

財布の Pay が尽きて請求に応えられなくなる「金欠」を、新しく Pay を配らずに和らげる。管理人が財布に「1on1を○回完走して稼いでこい」と命じ、財布が完走して報告し、管理人が受取印とご褒美で確かめる（設計は `TRIBUTE_DESIGN.md` 7節「出稼ぎ命令（財布の金欠対策）」）。

ユーザーの決定: ログイン報酬ではなく出稼ぎ命令にする（ログイン報酬は匿名のサブ垢が受け取って献上で一人の管理人に集められるため）。申し込みの既定は「受ける」、回数は 1／3／5／10回。

- 操作: `work_order`・`work_withdraw`・`work_confirm`（管理人）、`work_report`・`set_work_orders`・`work_progress`（財布。`work_progress` は読み取りだけ）
- 数えるのは命令の後に確定した通常型・戦略型1on1の正式完走（`economyProgress` の `achievementStats.totalMatches`、マイスタジアムと同じ正本）。報告の数はサーバーが記入し、端末からは受け取らない
- 命令した時の完走数は、財布だけが読める `tributeContracts/{id}/private/work` に置く（Firestore ルールは変更なし）
- Pay は動かさず、新しく発行もしない。期限・罰・通知はない

- 実装コミット: `b218fad`（PR #7、main とのマージ `6e2f1af`・`cac32df`・`5b00421`）、main へのマージ: `84a0807`。作業フォルダ `.claude/worktrees/ranch-work-orders`、ブランチ `feature/ranch-work-orders`（`origin/main` `18f3b2d` から）

## 配信対象

- Functions: `tributeAction` だけ
- Hosting / workers.dev / hariaistadium.com: `index.html`、`tribute.js`・`tribute.css`（キャッシュキーの末尾 `ranch-work-orders-v1`）、`tribute-core.mjs`（`tribute.js` からの読み込みの印の末尾 `ranch-work-orders-v1`）。ほかの公開ファイルは変更なし。Hosting は169ファイル
- 本番のデータ: 書いていない

## 公開前の検証

- `npm --prefix functions run check`（predeploy と同じ）: **2,216件中2,184件成功・失敗0・32スキップ**（エミュレータ専用）
  - `functions/test/tribute-work-orders.test.js`（11件）: 命令より前の完走を数えない、回数で頭打ち、端末の数を使わない、1契約1件、設定での取り消し、契約の終了、確認は1回だけ、ご褒美は言葉の強さに従う、どの操作でもウォレットと利用履歴が変わらない、管理人の画面に進み具合が出ない、進み具合を数え直すのは命令ごとに1回
- エミュレーター（`demo-gazostadium`、本物の `firestore.rules`）: `private/work` は財布だけが読め（200）、管理人・ほかの人は読めず（403）、誰も書けない（403）。限度額（`private/limits`）も管理人は読めない（403）
- 見本（`?tributePreview=thread-payer`・`thread-manager`・`apply`・見学用の見本の契約、幅375px）で、命令 → 報告 → 確認 → 取り下げと設定を操作して確認

## 本番反映結果

- Functions・PR のマージ・Hosting は Claude が作業フォルダから実行した（`git rev-parse HEAD` を確かめてから）
- `firebase deploy --only functions:tributeAction`（`5b00421`）: predeploy の全テストが通過。`functions:list`: 37関数すべて ACTIVE（nodejs24）。変わったのは `tributeAction` だけ（`3a828657772aa0663e8b06ab97c5a21d5e1be37b` → `7109a97168acbd9ebf3778eb269830d34f94b306`）
- PR #7 を main へマージ（`84a0807`）。workers.dev の自動ビルド（Workers Builds: gazostadium）は success（14:34:28Z）。この時点（14:34:44Z）で workers.dev・hariaistadium.com は `84a0807` と一致、web.app・firebaseapp.com は前回のまま
- `firebase deploy --only hosting`（`84a0807`、169ファイル）
- `node functions/scripts/verify-tribute-work-orders-release.cjs`（読み取りのみ、14:35:18Z）: 4経路すべてで `index.html`（そのまま・招待リンクの形・`?open=ranch` の形）と `tribute.js`・`tribute.css`・`account.js`・`app.js`・牧場のモジュール3つ・安心ページがコミット `84a0807` と一致。前回までの公開の印が残り、設計書・設定・サーバーのコード・`functions/.env.gazostadium`・スクリプト・テスト・`.claude/launch.json` が404
- web.app が配る `tribute.js`・`tribute-core.mjs`（取得だけ）が新しいキャッシュキーで、出稼ぎ命令の画面（`renderWorkOrder`・`refreshWorkProgress`・「出稼ぎの設定」）と表（`WORK_ORDER_TARGETS`・`workOrderView`・`workOrderNotesFor`）を含むことを確認

## 残っていること

- 本番での命令・報告・確認の操作は確認していない（テスト・見本・プレビューで確認）。本番のページをブラウザーで開くと匿名のゲストが作られるため、ページの読み込みもしていない
- `expireTributeContracts` と共通ブロックの関数は前の版のまま。期限切れ・ブロックで終わった契約は命令を消さないが、終わった契約では命令を表示しないので影響はない。次に牧場の Functions を出す時にそろう
- 第2段（未受取の報酬の額、1on1の結果画面の「出稼ぎ 2/3」、貢ぎ報告の画像、出稼ぎの実績系列）は未着手
