# お貢ぎ牧場：管理人の写真アイコン11種（2026-10-24）

## 対応内容

ユーザーの要望: お貢ぎ牧場の管理人のアイコンを追加したい。画像は ChatGPT で生成した架空の人物（ユーザーの申告。肖像権の問題なし）。

- 13〜23番の11枚を追加。いまの12枚と同じく無料（ユーザー決定）
  - 写真・地雷系（13〜16）: 白金・眼鏡・うさぎ・銀メッシュ
  - 写真・夜ギャル（17〜23）: 金髪・黒髪・まとめ髪・サングラス・赤・頬杖・ファー
- 受け取った14枚のうち、クロミのぬいぐるみ（サンリオのキャラクター）、モンスターエナジーの缶（ロゴ）、ルイ・ヴィトンのモノグラムのバッグが写った3枚は外した（ユーザー決定。著作権・商標のため。X に出す画像にもアイコンが入るため）
- ユーザーの圧縮前の画像から1枚ずつ、顔を中心に 256×256 の WebP で切り抜いた（1枚7〜11KB）。胸元が入らないようにし、円の縁に透明部分が出ないよう写真の内側だけを使う。イラストの112pxより大きくし、財布募集・貢ぎ報告の画像でぼやけないようにした
- 「架空の人物」の表示は出さない（ユーザー決定: 参加者はなりきりのロールプレイとして承知している）
- サーバーは `avatar` 0〜23 を受け付ける。カードの編集では「イラスト」「写真・地雷系」「写真・夜ギャル」の3段に分けて並べ、案内の文を「23種」にした
- 既存の `tribute-kidoku.test.js` が LF の改行を前提にしており、Windows で新しく取り出した作業フォルダ（CRLF）では落ちたため、読み込み時に改行を揃えるようにした

- 実装コミット: `4068df4`、確認スクリプト: `ab07250`（origin/main）
- 本体のフォルダはほかのセッションの作業中（`codex/security-hardening-20261023`）だったため、`origin/main` から切った別の作業フォルダ `.claude/worktrees/ranch-photo-icons`（ブランチ `release/ranch-photo-icons`、追跡先なし）で作業し、公開もそこから行った

## 配信対象

- Functions: `tributeAction` だけ（アイコン番号の上限）
- Hosting / workers.dev: 新しいファイル `assets/tribute-avatars/avatar-13.webp`〜`avatar-23.webp`（11枚）。`index.html`、`tribute.js`・`tribute.css`（キャッシュキー `ranch-photo-icons-v1`）、`tribute-core.mjs`（`…-ranch-board-fresh-v1-ranch-photo-icons-v1`）。`tribute-share.mjs`（`ranch-kidoku-v1`）・`tribute-deco.mjs`（`ranch-frame-color-v1`）は変更なし
- Firestore ルール・インデックス・Realtime Database ルール・データの書き換え: なし

## 公開前の検証

- `npm --prefix functions run check`（predeploy と同じ。作業フォルダで `npm ci` した依存で実行）: **2,039件中2,008件成功・失敗0・31スキップ**（エミュレータ専用）
  - アイコンの一覧がサーバーと画面で同じ（0〜23、イラスト12・地雷系4・夜ギャル7）、どの画像も WebP で 20KB 未満、24番以上は文字の印に戻る
  - カードの編集が3段に分かれ、画像のアップロードはない
- firebase-tools の `listFiles` で公開対象を数え、139ファイル（新しいアイコン11枚）で `.claude` を含まないことを確認
- 公開前に、本番3経路の `index.html` が `origin/main`（`f143b39`、ほかのセッションのセキュリティ対応を含む）と一致し、37関数すべてが nodejs24 で `tributeAction` が `1199347…` であることを確認
- 見本（幅375px）で、カードの編集の3段、写真アイコンを選んだ時の掲示板での見え方を確認。財布募集（20番）と献上レシート（14番）の画像をヘッドレス Edge で描き、写真アイコンがぼやけないことを確認

## 本番反映結果

- Functions・push・Hosting はユーザーが手元の PowerShell で、作業フォルダから実行した。push は `f143b39..ab07250`
- `functions:list`: 37関数すべて ACTIVE（nodejs24）。公開前と比べて変わったのは `tributeAction`（`1199347…` → `224adef0f8ed8340866cd7ed4ef032950c7f0b85`）だけ
- workers.dev の自動ビルド（Workers Builds: gazostadium）は success（04:52:50Z）
- `node functions/scripts/verify-tribute-photo-icons-release.cjs`（読み取りのみ、04:54:08Z）: 3経路すべてで `index.html`（招待リンクの形で開いた時も）・`tribute.js`・`tribute.css`・`tribute-core.mjs`・`tribute-share.mjs`・`tribute-deco.mjs` が `ab07250` と一致（改行を揃えて比較）し、アイコン11枚が `image/webp` でバイト列まで一致。前回までの公開の印（`ranch-board-fresh-v1` から `retire-free-table-v1` まで、スタジアムの `my-stadium-v1`・`my-stadium-v1-diorama-v1`）が残り、設計書・設定・ルール・インデックス・サーバーのコード・確認スクリプト・テストが404
- 本番（web.app）の内蔵ブラウザ: 新しいキャッシュキーの `tribute.js`・`tribute.css` が読まれ、本番の `tribute-core.mjs` が23種と3つの段を返し、20番のアイコンが 256×256 で読めた。コンソールのエラーは0件。牧場を開く操作・カードの保存は本番では行っていない（ページの読み込みだけ）
- 公開の後、ユーザーのターミナル（PowerShell 7.6.6）が起動直後に落ちるようになった（更新のお知らせを狭い画面幅で描く時の PowerShell 側の不具合）。公開の手順には影響していない

## 互換性と限界

- 本番の HTML は `Cache-Control: max-age=3600` のため、公開前に開いていた人は最大1時間ほど、13〜23番を選んだ管理人の印が文字の印に見える（読み直せば写真になる）
- 2人での通しの操作、iPhone／Android 実機・Safari での確認は行っていない
