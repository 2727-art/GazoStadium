# トップの見本をなりきりDMに

## 本番反映

- 2026-10-07、main への push（workers.dev は自動配備）→ Hosting の順で配備。
- ソースコミット: `f61c765`（main は `5f45416..f61c765` の fast-forward）。
- Hosting release: `sites/gazostadium/channels/live/releases/1791378440005000`（**22:07:20 JST**）。
- Hosting version: `sites/gazostadium/versions/5e4b6a4136cf4719`。CLI のアップロード対象は92ファイル（前回の91ファイル＋`landing-hero.mjs`）。
- 配備は管理 worktree（`.claude/worktrees/chat-persona-share`）から実行。メインのチェックアウトは origin/main より古いため使っていない。
- Functions、Database Rules、Firestore Rules、Indexes、保存データの変更・削除は行っていない。

## 仕様

- 見本は X のDMの貼り合いを「もっと盛れる場所」として見せる。DMの見出し（シオン・「小悪魔で貼り合い中」・P2P）、通常型1on1と同じなりきり吹き出し（相手は小悪魔の吹き出しとハート、こちらが付けた口紅のリアクション）、口調に合わせた入力中の一文、90点の返事に「CRITICAL」の札。
- 口調スイッチは6つの口調セットと同じ並び。選ぶと返事の吹き出しとセリフ（対戦で実際に出る高得点帯のリアクションの1つ目）だけが変わる。対戦の設定・保存値・通信には触れない。
- 演出は見本が35%見えた時に1回だけ（画像→ひとこと→90点のカウントアップとメーター→CRITICAL→口紅→入力中）。トップへ戻って描き直した時と「視差効果を減らす」設定では再生しない。描画が止められても点数は最後に90へそろえる。
- 入口の人数は0をそのまま出さない。相手待ちと対戦中のいる方だけを「いま2人が相手待ち・4人が対戦中」のように書き、両方0なら「一番乗りで待ってみる」、読めない時は人数の行を出さない。既存の `heroSoloWaitingCount` / `heroSoloPlayingCount` の更新経路は維持。
- 入口の下に「画像はサーバーに残らない」「登録なしですぐ」「なりきり口調6種」。その下に名場面カードの予告（相手の発言は許可した時だけ載る）。
- スマホは見出し→入口→見本の順（読み上げ順は見出し→見本→入口のまま、並べ替えは見た目だけ）。PCは左に見出しと入口、右に見本と口調スイッチ。

## 検証

- 全体: **1,908 tests / 1,879 pass / 0 fail / 29 skip**。新規 `functions/test/landing-hero-persona.test.js` は7件。既存のトップ関連テスト（見本画像・90点表記・PCの列幅・人数ID・自由卓の札など）はすべて変更なしで成功。
- ローカルで幅390x844のスマホ表示を確認。入口のボタンは上から311〜408px、見本は528pxから始まり、DMの見出しと画像の上部は最初の画面に入る。
- 360px・320px幅で見本の中身のはみ出しなし。320px幅では既存の下部タブが8pxはみ出すが、今回の変更とは無関係。
- PC 1280x800 で、左（見出し・入口・チップ）と右（見本・口調スイッチ）の2列、入口は最初の画面内（469〜566px）。
- 口調の切り替え（明るい配色の甘えんぼを含む）、5通りの人数表示、描き直し時の再結び付けと演出の非再生、演出後に90点で止まることを確認。
- 実機の iPhone、X のアプリ内ブラウザ、実アカウントでの確認は行っていない。

## 独立した配信確認

`node functions/scripts/verify-hero-persona-release.cjs` を実行。

- **22:08:23 JST**、web.app / firebaseapp.com / Cloudflare の3経路で成功。
- 通常URL・cache-buster付きHTML、HTMLが参照する `app.js`・`velvet.css`・`landing-hero.mjs`、`landing-hero.mjs` が import する `finish-roleplay.mjs` の通常/検証用URL、合計30件で 200/MIME/LF正規化ハッシュ一致。
- 非公開4パス×3経路、合計12件は404。
- 証拠: 同ディレクトリ `HERO_PERSONA_RELEASE_QA.json`。
