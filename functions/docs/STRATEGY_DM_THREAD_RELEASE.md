# 戦略型1on1：DMスレッド化（第1段・見せ方）（2026-11-03）

## 対応内容

ユーザーからの相談: 貼り合いの主戦場はXのDMで、プレイヤーは通常型1on1に集まり、戦略型1on1は人気がない。WEAKNESS SCOUT CHAT が独立していて時系列で見られず、画像にもチャットにも集中できないのが原因ではないか。10秒動画や音声をチャットで送れるのは戦略型の見所なので伸ばしたい。設計書 `STRATEGY_DM_THREAD_DESIGN.md` の3つの案（PCの読みメモは右の列、自分の番のシートは自動で開かない、匿名のころの会話をスレッドの先頭に出す）はユーザーが案のまま決めた。

- 対戦中は通常型1on1と同じXのDMの骨組み（DMヘッダー・スレッド・段階の帯・操作シート・チャットの入力欄）で進む
- 1手を出来事（貼った・点数・権利・答え・看破・答え合わせ・仕留め・見送り・参りました）に分け、チャットと短尺映像をその間に、この端末で起きた順に積む。並びは純粋な部品 `strategy-dm-thread.mjs`
- 匿名のころの会話はスレッドの先頭にヴェール越しのまま残す。対戦中のチャットは200件まで手元に残す（入室時に読むのは今と同じ直近60件）
- 入力欄のカメラボタンから今の録画ダイアログを開く。映像は送った側・受けた側の吹き出しで出し、自動再生しない（本数は今のまま対戦中1本）
- 描き直しでは中身が同じ吹き出しを作り直さない（画像を読み直さず、再生中の映像も止まらない）。打ちかけのチャットも残す
- 自分の番は帯の主ボタンで操作シートを開く（採点だけは画像を開いたら開き、点を付ける1枚を小さく出す）。スマホでは入力欄の上（理性ゲージを畳む）、PC（901px以上）では右の列の一番上
- 読みメモと自分の秘密は、PCでは右の列、スマホではヘッダーの「メモ」から開く引き出し
- 対戦中は古いHUD・ルーム帯・チャット枠・スマホのチャット帯を出さない（試合前・最後の照合・品評会は今のまま）
- 点数の吹き出しは、ひとことがなくてもメーターが読める幅にした（共通の `.ha-bubble` が後から読み込まれて細くつぶれていた）
- `?strategyPreview` に「映像が届いた」を足し、見本のスレッドにもチャットを挟んだ。README の戦略型の説明を更新

- 実装コミット: `ffe3aec`（本体）、`83488ee`（README・確認スクリプト）。PR [#33](https://github.com/2727-art/GazoStadium/pull/33) をマージし、main は `a51a492`
- 本体のフォルダはほかの作業のブランチ（`codex/ranch-edge-case-fixes`、未コミットの変更あり）だったため、`origin/main`（`5d3f995`）から切った作業フォルダ `.claude/worktrees/strategy-dm-thread`（`feature/strategy-dm-thread`）で作業し、公開は同じフォルダをマージ後の `a51a492` に切り替えて行った

## 配信対象

- Hosting / workers.dev: `index.html`、`strategy.js`・`strategy.css`（キャッシュキーの末尾に `strategy-dm-thread-v1`）、新しいファイル `strategy-dm-thread.mjs`（`?v=strategy-dm-thread-v1`）
- Functions・Firestore ルール・インデックス・Realtime Database ルール・データの書き換え: なし（通信の形・手番・点数・勝敗の判定・リアクションの宛先キーは変更なし）
- 非公開: `STRATEGY_DM_THREAD_DESIGN.md` を `firebase.json` の `hosting.ignore` と `.assetsignore` の両方に追加

## 公開前の検証

- `node --test functions/test/*.test.js`: **2,449件中2,383件成功・30件失敗・36スキップ**。失敗30件は、変更前の `origin/main`（`5d3f995`）を別の作業フォルダで流しても同じ一覧で落ちる（牧場・トップの資産照合やキャッシュキーの記録。この環境の改行の違いによる）。今回の分（新しい `strategy-dm-thread.test.js` と直した既存テスト）はすべて成功
- `?strategyPreview`: 320・390・1280px で全段階を表示し、横はみ出しなし。シートをスレッドに重ねると最新の画像が隠れること、メモの引き出しが2列に崩れることを見つけて直した
- エミュレータ（auth・database・firestore・functions）と2つのオリジン（`localhost:5185`／`127.0.0.1:5185`）で2人対戦を2回通した
  - 1回目: 匿名偵察のチャット → 受諾・封印・正体判明 → チャット → 1手目 → 開いて採点の前にチャット → 91点 → 質問と答え → 10秒動画（カメラはキャンバスの映像で代用） → 連投の2手目 → P2Pのリアクション → 60点 → 降参 → 最後の照合 → 両者の結果画面とサーバーでの記録。両者のスレッドが同じ順に並び、描き直しで画像・動画の要素が作り直されないことを確認
  - 1回目で、1024×768のPCで操作シートを開くとスレッドが37pxまで縮む不具合を見つけ、PCではシートを右の列に出すよう直した
  - 2回目（片方PC幅・片方スマホ幅）: 本命への強がり2回 → 看破成功（「効いてないって言ったよね♡」に1手目と3手目） → 2枚の仕留め（理性−20） → 降参。PCはシートが右の列（スレッド310px）、スマホは入力欄の上になることを確認。この対戦では Functions の呼び出しがすべて成功した
- firebase-tools の `listFiles` で公開対象を数え、766ファイル（すべて git 管理下）。main から増える公開ファイルは `strategy-dm-thread.mjs` だけで、設計書・README・設定・テスト・`.claude` を含まない
- 公開前、4経路すべての `index.html` が `origin/main`（`5d3f995`）と一致。main は作業中に動いておらず、ほかの公開を巻き戻さないことを確認
- 追加したコードに正規表現の後読み（iOS 16.4 未満で読み込めない）はない

## 本番反映結果

- main へのマージ（PR #33、08:51:39Z）で workers.dev の自動ビルド（Workers Builds: gazostadium）が success（08:52:07Z）。workers.dev・hariaistadium.com とも 08:52:09Z に新しい `index.html` を返した
- Hosting は Claude が作業フォルダ（`a51a492`、変更なし）から `firebase deploy --only hosting --project gazostadium --non-interactive` で公開（766ファイル、release complete）。コマンドは HEAD と `origin/main` が `a51a492` で作業フォルダに変更がない時だけ動くようにした
- `node functions/scripts/verify-strategy-dm-thread-release.cjs --write`（読み取りのみ、08:52:24Z）: web.app・firebaseapp.com・workers.dev・hariaistadium.com の4経路すべてで、`index.html`、`strategy.js`・`strategy.css`（新しいキャッシュキー）、`strategy-dm-thread.mjs`、変えていない `online.js`・`velvet-battle.css`・`app.js`・`strategy-chat.mjs`・`strategy-video-transfer.mjs`・`strategy-hariai-core.mjs`・`chat-persona.mjs` が `a51a492` と一致（改行を揃えて比較）。前回までの公開の印（`mirage-achievement-link-v1`・`monthly-single-champion-v1`・`ranch-premium-icons-v3`・`normal-dm-gaze-v1`・`normal-dm-thread-v1`・`strategy-persona-chat-v1`・`my-stadium-v1`）が残り、設計書・README・設定・テスト・確認スクリプト・手元の e2e 補助が404。結果は `STRATEGY_DM_THREAD_RELEASE_QA.json`
- 本番（hariaistadium.com）の内蔵ブラウザ: 機能の一覧と `data-src` に新しいキャッシュキーが載り、`strategy-dm-thread.mjs` を読み込んでスレッドの並びが組めた。コンソールのエラーは0件。戦略型の画面・ログイン・対戦は本番では行っていない（匿名アカウントと本番戦績を作らないため）

## 互換性と限界

- 本番の HTML は `Cache-Control: max-age=3600` のため、公開前に開いていた人は最大1時間ほど旧画面のまま、または旧いHTMLと新しいスクリプト・スタイルが混ざった見た目になりうる。通信の形とリアクションの宛先キーは変えていないので、新旧の画面同士でも対戦できる
- iPhone／Android 実機・Safari での確認は行っていない（スマホのキーボードと入力欄の重なりを含む）
- 本物のカメラで撮った映像の送受信は、この公開では確かめていない（エミュレータではキャンバスの映像で代用）
- 第2段（対戦中のボイス、映像の本数、再生済み・既読、見つめるモード、匿名偵察と品評会も同じスレッドへ）は設計書の13章のとおり未着手
