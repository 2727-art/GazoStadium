# 戦略型1on1：DMスレッド第2段（ボイス・映像3本・既読と再生済み）（2026-11-04）

## 対応内容

ユーザーの依頼: DMチャットの第2段として、対戦中のボイス、動画の本数を増やす、「再生済み」「既読」を入れる。10秒の映像と声は戦略型1on1ならではの見どころなので、対戦中にもっと使えるようにする。試合前（カードを封印する前）の WEAKNESS SCOUT CHAT は今のまま残す。

- ボイス: 対戦中に1人5本まで、1本10秒まで。入力欄のマイクボタンで録り、聞き直してから送る。22.05kHz・モノラル16bit WAV・約480KB以下に変換し、品評会と同じ専用チャネル（`hariai-strategy-review-assets-v1`）で `strategy-voice-start` → 16KBずつ → `strategy-voice-end` と送る。受け手は送り手・段階・手数・大きさ・秒数・形式の申告と、実データ（WAV の長さ）を確かめる（`strategy-voice-transfer.mjs`）。スレッドには再生ボタン・波形・秒数の吹き出しで出し、自動再生しない
- 映像: 対戦中の短尺映像を1人1本から3本へ。カメラボタンに残りの本数を出す。品評会は1本のまま
- 既読: 相手が自分の最後のチャットまたは画像を見たら、その下に「既読」を出す（スレッドの最後が自分の発言の時だけ）
- 再生済み: 自分の映像・ボイスが再生されたら、その吹き出しに「再生済み」を付ける
- 切り替え: 対戦メニューの「既読・再生済みを付ける」（端末に保存、初期はオン）。オフにすると自分から送らず、相手のものも見えない
- 機能の交換: つながった時に main チャネルで `strategy-features`（ボイス5・映像3・既読あり）を送り合う。届かない相手（古い版）とは、ボイスなし・映像1本・既読なしで対戦する。合図 `strategy-receipt`（`seen` / `played`、キーは1回20件まで、自分のものだけ受け付ける）は P2P だけで送り、保存しない
- チャットを打っている間はマイクとカメラを畳み、入力欄を広くする

実装コミット: `980f4f0`（機能）、`4e4fc96`（README と公開後の確認スクリプト）。PR [#37](https://github.com/2727-art/GazoStadium/pull/37) をマージし、main は `c441aee`。作業と公開は `origin/main`（`1619032`）から切った作業フォルダ `.claude/worktrees/strategy-dm-thread`（`feature/strategy-dm-voice`）で行った。設計は `STRATEGY_DM_THREAD_DESIGN.md` §14。

## 配信対象

- Hosting / workers.dev: `index.html`、`strategy.js`・`strategy.css`（キャッシュキーの末尾に `strategy-dm-voice-v1`）、`strategy-dm-thread.mjs`（`?v=strategy-dm-voice-v1`）、新しいファイル `strategy-voice-transfer.mjs`（`?v=strategy-dm-voice-v1`）
- Functions・Firestore・Realtime Database ルール・データの書き換え: なし（手の記録の形は変えていない）

## 公開前の検証

- エミュレータ（auth・database・firestore・functions）と2つのオリジン（`localhost` / `127.0.0.1`）で2人対戦し、次を確認:
  - 機能の交換: 対戦開始後、双方のマイクが「あと5本」、カメラが「あと3本」
  - チャットの既読: 送ったチャットの下に「既読」。相手が返すと消える
  - 画像の既読: 相手が画像を開いてから採点するまでの間、貼った側の画像の下に「既読」
  - ボイス: 2秒録って送ると、相手に吹き出し・波形・「3手目のころ・ボイス」が出て、再生できた。再生すると送った側に「再生済み」
  - 映像: 同じ人が3本続けて送り、3本とも届いた。3本目のあとカメラは「この対戦の映像は送り切りました」で止まる。「再生済み」は再生した1本にだけ付いた
  - 切り替え: オフにすると既読を送らず、相手から届いた既読・再生済みも出ない。オンに戻すと表示が戻る
  - 降参で決着し、両者の結果画面まで進んだ
  - 合図が P2P で実際に出ていることは、ページの中で `RTCDataChannel.prototype.send` を覗いて確かめた（2つのタブはどちらも `document.hidden` が false になるため）
- プレビュー（`?strategyPreview`、390px）: ボイスの吹き出しと再生位置、既読・再生済み、マイクとカメラの残り本数、入力中に畳む、横のはみ出しなし
- 新しい `strategy-voice-transfer.test.js`（往復、申告の拒否、はみ出し・不一致・途中切れ、WAV でない中身、送信の中断、ID と解放）と、`strategy-dm-thread.test.js` の追加分（ボイスの並び、機能と合図の検証、配線）
- 戦略型まわりのテスト: 273件中267件成功・0件失敗・6スキップ
- `node --test functions/test/*.test.js`: 2,463件中2,397件成功・30件失敗・36スキップ。失敗30件は、変更前の `origin/main` でも同じ一覧で落ちるもの（牧場・トップの資産照合やキャッシュキーの記録。この環境の改行の違いによる）で、新しい失敗はない
- 前の版（`1619032`）の `handleChannelMessage` は知らない種類の文字のメッセージを無視するので、古い版の相手に `strategy-features`・`strategy-receipt` を送っても何も起きない
- firebase-tools の `listFiles` で公開対象を数え、767ファイル（前回の766に `strategy-voice-transfer.mjs` を加えたもの）。設計書・README・設定・テスト・`.claude` を含まない
- 公開前に確認スクリプトを本番へかけ、変えた4件（`strategy.js`・`strategy.css` のキャッシュキー、`strategy-dm-thread.mjs`、`strategy-voice-transfer.mjs`）だけが失敗し、変えていないファイル・前回までの公開の印・非公開ファイルの404は通ることを確かめた
- 公開前、main は `1619032` から動いていなかった

## 本番反映結果

- main へのマージ（PR #37、09:07:43Z）で workers.dev の自動ビルドが success（09:08:13Z）
- Hosting は作業フォルダ（`c441aee`、変更なし）から `firebase deploy --only hosting --project gazostadium --non-interactive` で公開（767ファイル、release complete、09:09Z ごろ）。HEAD と `origin/main` が `c441aee` で作業フォルダに変更がない時だけ動くようにした
- `node functions/scripts/verify-strategy-dm-voice-release.cjs --write`（読み取りのみ、09:09:09Z）: 4経路すべてで、`index.html`、新しいキャッシュキーの `strategy.js`・`strategy.css`、`strategy-dm-thread.mjs`・`strategy-voice-transfer.mjs`、変えていない `online.js`・`velvet-battle.css`・`app.js` と戦略型のモジュール5つが `c441aee` と一致。前回までの公開の印が残り、非公開ファイル6つが404。結果は `STRATEGY_DM_VOICE_RELEASE_QA.json`
- 本番（hariaistadium.com）の内蔵ブラウザでトップページだけを開き、機能の一覧と `data-src` に新しいキャッシュキーが載ること、`strategy-dm-thread.mjs` と `strategy-voice-transfer.mjs` を読み込んで機能の交換と合図の検証が動くことを確かめた。コンソールのエラーは0件で、ログインの記録は作られていない。戦略型の画面・ログイン・対戦は本番では行っていない（匿名アカウントと本番戦績を作らないため）

## 互換性と限界

- 本番の HTML は最大1時間キャッシュされるため、公開前に開いていたページは古い `strategy.js` のまま動きうる。新しい版は古い版の相手を見分けて、ボイスなし・映像1本・既読なしで対戦する（古い版は2本目以降の映像を断るため）。古い版どうし・新しい版どうしは、それぞれの版のとおりに動く
- ボイスは相手の端末へ一時的に届くだけで保存しない。対戦の終わり・退出・ページ終了で解放する
- 実機（特に Android）でのマイクの許可・録音・再生は、この記録の時点では確かめていない
