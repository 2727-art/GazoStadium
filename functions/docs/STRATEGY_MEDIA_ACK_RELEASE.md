# 戦略型1on1：画像が手の記録より先に届いた時の受信の書き込み（2026-11-03）

## 対応内容

ユーザーの報告: Windows と Android（どちらも Chrome）で戦略型1on1をテストプレイしたところ、画像を送信したタイミングでかなりの頻度で双方の通信が切れた。Windows には「対戦データの整合性を確認できませんでした（スロット2の行動が確定していません。）。この対戦はノーコンテストです。」、Android には「ルームが破棄されました。画像と進行情報への参照を解放しました。」が出た。

原因: 画像は P2P（WebRTC DataChannel）で、手の記録（`moves/N/post`）は Realtime Database で届くため、画像のほうが先に着くことがある。受け手は画像を受け取り終えた瞬間に `moves/N/received/<uid>` を書いていた。手の記録がまだ届いていない端末では、この書き込みが手元のデータに先に反映され、「行動のないスロット」ができる。`replayHariai` がこれを弾き、`failWeaknessIntegrityCheck` が対戦を無効にしてルームを破棄していた（相手には破棄の画面が出る）。protocol v3（`2734b0e`、2026-09-30）からある書き方で、DMスレッド化（PR #33）とは無関係。エミュレータでは Database が常に先に届くため、これまでの確認では出なかった。

修正: 画像・音声を受け取り終えた時、その手（貼った・仕留め）の記録がもう端末に届いている時だけ受信を書く（`strategyMediaAckReady`）。まだなら画像を持ったまま待ち、記録が届いた時の自動処理（`performHariaiAutomaticSteps`、逆の順番の時にもともと使っていたもの）で書く。

- 実装コミット: `72cc4a7`。PR [#35](https://github.com/2727-art/GazoStadium/pull/35) をマージし、main は `b7ac6e6`
- 作業と公開は `origin/main`（`6c12cbe`）から切った作業フォルダ `.claude/worktrees/strategy-dm-thread`（`fix/strategy-media-ack-race`）で行った

## 配信対象

- Hosting / workers.dev: `index.html`、`strategy.js`（キャッシュキーの末尾に `strategy-media-ack-v1`）
- Functions・Firestore・Realtime Database ルール・データの書き換え: なし（通信の形は変えていない）

## 公開前の検証

- エミュレータ（auth・database・firestore・functions）と2つのオリジンで、受け手の Database 接続だけを一時的に切り（SDK 内部の `persistentConnection_.interrupt`、P2P はそのまま）、攻め手が貼った:
  - 修正前（`6c12cbe` の `strategy.js`）: 接続を戻した時点で、受け手に「対戦データの整合性を確認できませんでした（スロット2の行動が確定していません。）」、攻め手に「ルームが破棄されました。」が出て、報告どおりに再現した
  - 修正後: 受け手は画像を受け取っても受信を書かずに待ち、接続が戻って手の記録が届くと受信を書いて「開いて採点」へ進んだ。続けて採点、通常の順番の2手目、降参、両者の結果画面まで進んだ
- `strategy-image-send-runtime.test.js` に、画像（音声あり・なし）と仕留めの画像が記録より先に届く場合、記録が先の場合を追加。修正前の書き方（すぐ受信を書く）ではこのうち3件が失敗することを確認
- 戦略型のテスト（`strategy-*.test.js` と `hariai-dm-design.test.js`）: 239件中234件成功・0件失敗・5スキップ
- 公開前、main は `6c12cbe` から動いていなかった

## 本番反映結果

- main へのマージ（PR #35、09:59:10Z）で workers.dev の自動ビルドが success（09:59:40Z）。workers.dev・hariaistadium.com とも 09:59:49Z に新しい `index.html` を返した
- Hosting は作業フォルダ（`b7ac6e6`、変更なし）から `firebase deploy --only hosting --project gazostadium --non-interactive` で公開（766ファイル、09:59:39Z 完了）。HEAD と `origin/main` が `b7ac6e6` で作業フォルダに変更がない時だけ動くようにした
- `node functions/scripts/verify-strategy-media-ack-release.cjs --write`（読み取りのみ）: 4経路すべてで、`index.html`、修正の入った `strategy.js`（新しいキャッシュキー）、変えていない `strategy.css`・`online.js`・`velvet-battle.css`・`app.js` と戦略型のモジュール5つが `b7ac6e6` と一致。前回までの公開の印が残り、非公開ファイルが404。結果は `STRATEGY_MEDIA_ACK_RELEASE_QA.json`

## 互換性と限界

- 本番の HTML は最大1時間キャッシュされるため、公開前に開いていたページは古い `strategy.js` のまま動きうる。古いコードの側が受け手になった時は、その間は同じことが起こりうる。修正は受け手の側だけで効き、通信の形は変えていないので、新旧の画面同士でも対戦はできる
- 実機（Windows・Android）どうしでの再テストは、この記録の時点では行っていない
