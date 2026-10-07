# X リンクカードを「なりきりDM」に

## 本番反映

- 2026-10-07、main への push（workers.dev は自動配備）→ Hosting の順で配備。
- ソースコミット: `56d5b82`（main は `726a620..56d5b82` の fast-forward）。
- Hosting release: `sites/gazostadium/channels/live/releases/1791379552190000`（**22:25:52 JST**）。
- Hosting version: `sites/gazostadium/versions/0086a5648e101c8d`。CLI のアップロード対象は92ファイル（`/ogp.png` を外し、`assets/ogp/ogp.4193da908263.png` を追加）。
- 配備は管理 worktree（`.claude/worktrees/chat-persona-share`）から実行。
- Functions、Database Rules、Firestore Rules、Indexes、保存データの変更・削除は行っていない。

## 仕様

- 共有画像 `https://gazostadium.anjugames.workers.dev/assets/ogp/ogp.4193da908263.png`（1200×630 PNG、571,219バイト、SHA-256 `4193da90826353d2e806eacac952899483bc6063b85184393732f9753e0b32b0`）。
- 見た目はトップの見本と同じ「なりきりDM」。左に「#貼り合い」「貼って、刺して、点で返す。」「DMじゃ物足りない貼り合いに。女の子になり切れる吹き出しで。」とチップ2つ、右にDMの見出し・小悪魔の吹き出しと口紅・CRITICAL 90点・入力中の一文。前の版の「AI文字コラ」「ルーレット」の札は外した。
- X がカード左下に重ねるタイトルの札（ユーザーの下書き画面で測った位置：画像座標 x 29〜337、y 559〜602）には何も置かない。画像内にURLは入れない。`og:title` は短い「貼り合いスタジアム」のまま。
- `og:description` / `twitter:description` は「DMじゃ物足りない貼り合いに。女の子になり切れる吹き出しで、推し画像を貼り合って刺さり具合を点で返す1on1。画像はサーバーに残りません。」。サイト全体の `description` は変えていない。
- 画像は内容のSHA-256先頭12桁を含む名前にし、取得済みの古い画像が使われ続けないようにした。以前の `/ogp.png` は配信から外した（すでに投稿されたXのカードは、X側が保存した画像を使う）。長期 `immutable` のキャッシュ設定は付けていない。
- 画像は `functions/scripts/ogp-card.html`（非公開）をヘッドレスの Chrome で撮影して作成（`node functions/scripts/render-ogp.cjs`）。同じひな形から再作成すると同じバイト列になることを確認。

## 検証

- 全体: **1,909 tests / 1,880 pass / 0 fail / 29 skip**。`functions/test/landing-ogp.test.js` は5件（名前と中身の一致、1200×630 PNG、5MB未満、TwitterとOpen Graphの一致、左下を空けるチップの1行配置、画像内にURLなし、旧 `/ogp.png` の廃止、ひな形の非公開）。
- 幅360px相当への縮小とXのタイトルの札の重ね合わせで、見出し・吹き出し・90点が読めること、札が空き場所に収まることを目視確認。
- X の実際のカード表示（下書きへの貼り付け）は、この記録の時点では未確認。

## 独立した配信確認

`node functions/scripts/verify-ogp-release.cjs` を実行（User-Agent `Twitterbot/1.0`、読み取りのみ）。

- **22:26:20 JST**、web.app / firebaseapp.com / Cloudflare の3経路で成功。
- 初期HTML（Cloudflareは `/` と `/?v=2`）が手元と同一で、`og:*` と `twitter:*` の各タグが1つずつ・期待どおりの値。
- 共有画像は3経路とも 200・`image/png`・SHA-256一致・1200×630。キャッシュは Firebase が `max-age=3600`、Cloudflare が `public, max-age=0, must-revalidate`（長期 `immutable` なし）。
- 以前の `/ogp.png` は3経路とも404。`robots.txt` はテキストで、取得を妨げる応答ではない。
- 証拠: 同ディレクトリ `OGP_HARIAI_RELEASE_QA.json`。
