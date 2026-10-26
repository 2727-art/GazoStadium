# 通常型1on1：DMスレッド化（第1段・表示だけ）（2026-10-26）

## 対応内容

ユーザーの要望: 通常型1on1はカード対戦の色が強い。貼り合いは女の子になりきって相手の癖を探し、チャットと画像で相手を負けさせるサブカルチャーなので、自分が出したカードは画面に出さず、相手のカードとチャットを主役にしたい。モック（DMスレッド型・8画面）で方向を決め、第1段（表示だけ）を実装した。設計は `NORMAL_DM_THREAD_DESIGN.md`。

- マッチ成立（VS）の後は、DMヘッダー（相手の名前・口調・ROUND・ふたりの理性）、スレッド、その時の操作枠、チャット入力欄の1画面で進む。チャットはスレッドに統合し、別枠のチャットはなくした
- 自分が貼った画像はスレッドに出さず「画像を1枚貼った ✓」とひとことだけ（押すと自分だけ拡大で確認できる）。相手の1枚はDMのメッセージとして届き、すぐ下で採点する
- 点数は返した点数と返ってきた点数を、それぞれの口調の吹き出しで積む（まだ平気／効いた／刺さった／堕ちかけ）。CRITICAL・PERFECTのスタンプとカードめくりは廃止
- 選ぶ時は下からの手札シート。そのラウンドのひとことを「登録したもの・自分の口調の定型・言葉なし」から選べる（ユーザー決定: 自由記述は準備画面だけ）
- FINISH: 負けた側にはとどめになった相手の画像とひとこと・決め台詞、勝った側には自分の画像を出さず落とした相手のアイコンと「理性 0」、とどめになった自分のひとことと点数
- シグネチャーカードは廃止（ユーザー決定）。古い画面の相手のため、`image-start` の `signature` は常に `false` で送る
- 試合結果は残りHP・合計獲得点・CRITICAL の数字の代わりに「いちばん効かされた1枚」と「相手に効いた、あなたの言葉」
- 相手の画像は試合の終わりまで端末内に残す（ユーザー決定。最大5枚、Firebaseには送らず、試合後の再戦・退出・ページ終了で解放）
- 通常型1on1の表示・遊び方ページ・トップの見本で HP を「理性」と呼ぶ（ユーザー決定）。PCも中央にDMの1列（ユーザー決定）
- `?battlePreview` は ROUND 3 のDMスレッドを組み立てて全13段階を確認できる

- 実装コミット: `9b18e7e` → main の更新に合わせて `77024f7` へ載せ直し。PR [#5](https://github.com/2727-art/GazoStadium/pull/5) をマージし、main は `e6570a5`
- 本体のフォルダはほかのセッションのブランチ（`codex/ranch-illustration-icons`）だったため、`origin/main` から切った作業フォルダ `.claude/worktrees/normal-dm-thread` で作業し、公開は同じフォルダの `release/normal-dm-thread`（`e6570a5`、追跡先なし）から行った

## 配信対象

- Hosting / workers.dev: `index.html`、`online.js`・`velvet-battle.css`・`app.js`（キャッシュキーの末尾に `normal-dm-thread-v1`）、新しいファイル `normal-dm-thread.mjs`（`?v=normal-dm-thread-v1`）、`how-to-play/index.html`
- Functions・Firestore ルール・インデックス・Realtime Database ルール・データの書き換え: なし（通信の形・点数計算・勝敗判定は変更なし）
- 非公開: `NORMAL_DM_THREAD_DESIGN.md` を `firebase.json` の `hosting.ignore` と `.assetsignore` の両方に追加

## 公開前の検証

- `node --test functions/test/*.test.js`（main へ載せ直した後）: **2,172件中2,140件成功・失敗0・32スキップ**（エミュレータ専用）
  - 新しい `normal-dm-thread.test.js`: スレッドの積み方、点数の言葉、いちばん効いた1枚、効いた言葉、相手の口調の推定
  - 配線テスト: DMの骨組み、チャットの統合、自分の画像をスレッドに描かないこと、相手の画像を試合の終わりまで残すこと、シグネチャーの廃止、FINISH の勝ち負けでの出し分け、キャッシュキー
- `?battlePreview`: 全13段階を幅375px・1280pxで表示し、横スクロールなし・スレッドが最新に追従・自分の画像がスレッドに出ないことを確認
- エミュレータ（auth・database・firestore・functions）と2つのオリジン（`localhost:5173`／`127.0.0.1:5173`）で2人対戦を通した: 4ラウンド、P2Pの点数リアクション、追撃セリフ、勝ち負け両方の FINISH、返礼の受け渡し、サーバーでの結果確定、両者の試合結果（効かされた1枚の画像が試合終了後も読める）
- firebase-tools の `listFiles` で公開対象を数え、169ファイルで `.claude`・`functions`・`.md` を含まないことを確認
- 公開前、web.app・firebaseapp.com の `index.html` は `3b84444`（main より古い）、workers.dev・hariaistadium.com はマージ済みの `e6570a5` と一致。main からの公開でほかの公開を巻き戻さないことを確認

## 本番反映結果

- main への push（PR #5 のマージ、10:16:15Z）で workers.dev の自動ビルド（Workers Builds: gazostadium）が success（10:16:44Z）
- Hosting は Claude が作業フォルダから `firebase deploy --only hosting --project gazostadium` で公開（10:18:27Z 開始、新しいファイル6件をアップロード）
- `node functions/scripts/verify-normal-dm-thread-release.cjs 2026-10-26T10:18:27Z`（読み取りのみ、10:19:01Z）: web.app・firebaseapp.com・workers.dev・hariaistadium.com の4経路すべてで `index.html`・`online.js`・`velvet-battle.css`・`app.js`・`normal-dm-thread.mjs`・`how-to-play/` が `e6570a5` と一致（改行を揃えて比較）。前回までの公開の印（`ranch-edge-fixes-v1`・`ranch-illustration-icons-v1`・`my-stadium-v1`・`chat-persona-v2`・`girl-voice-casual-v1`）が残り、設計書・README・設定・テスト・確認スクリプトが404。結果は `NORMAL_DM_THREAD_RELEASE_QA.json`
- 本番（web.app）の内蔵ブラウザ: 新しいキャッシュキーの `online.js`・`app.js`・`velvet-battle.css` が読まれ、`online.js` が初期化され、トップの見本が「刺さった」「理性30」になっていた。コンソールのエラーは0件。対戦・ログインの操作は本番では行っていない（ページの読み込みだけ）

## 互換性と限界

- 本番の HTML は `Cache-Control: max-age=3600` のため、公開前に開いていた人は最大1時間ほど旧画面のまま。通信の形は変えていないので、新旧の画面同士でも対戦できる（新しい画面は常に `signature: false` を送るので、旧画面の相手に SIGNATURE FINISH は出ない）
- iPhone／Android 実機・Safari での確認は行っていない。特に、スマホのキーボードが下の入力欄に重ならないかは未確認
- 対戦開始直後（ROUND 1 の最初）に送ったチャットが、エミュレータで1回だけそのラウンドの画像の後ろに並んだ。ROUND 2 で同じ操作をした時は正しい位置に入った
