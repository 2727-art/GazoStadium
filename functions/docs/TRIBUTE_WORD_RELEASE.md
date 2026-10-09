# お貢ぎ牧場：今日のひとこと（2026-10-09）

## 対応内容

- 今日のひとこと: 管理人カードのある人が、30文字までの一言を掲示板のカードと管理人の詳細に吹き出しで出せる（「今日のひとこと ・ 2時間前」）。24時間で消え（期限の切れた言葉はサーバーが返さない）、日本時間の1日3回まで出せる。消しても回数は戻らない
- 出すと `lastActiveAt` が更新され、掲示板（受付中を最近の活動順に並べる）で上に並ぶ。回数の上限は、上に居続けるための連投を防ぐため
- 禁止表現（連絡先・外部決済・現金・会う約束・個人情報・晒しの脅し）に加え、掲示板は性的な名目に同意する前の人も見るため、性的な言葉（寸止め・射精・お漏らし・エロ など）を書けない。普通のカタカナ語（イケメン など）は通る
- 入力は契約画面の「管理人として」の欄。いまの言葉・消えるまでの時間・今日あと何回・消すボタンを出す。「残り何枠」のような希少性の表示は出さない
- サーバーでは、`state`・`save_profile`・`set_word` が同じ形の自分のプロフィール（`ownProfileView`、今日出した回数を含む）を返すようにまとめ、`publicCard` は時刻を受け取って期限切れの言葉を落とす

- 実装コミット: `0bec0aa`、確認スクリプト: `3c44933`（origin/main）

## 配信対象

- Functions: `tributeAction` だけ（新しい操作 `set_word` と、カードの今日のひとこと）。他の関数は更新していない
- Hosting / workers.dev: `index.html`、`tribute.js`・`tribute.css`・`tribute-core.mjs`（キャッシュキー `ranch-word-v1`）。`tribute-share.mjs` は変更なし（`ranch-collar-v1` のまま）
- Firestore ルール・インデックス: 変更なし（掲示板の問い合わせは従来の `accepting` と `lastActiveAt` のまま）

## 公開前の検証

- `node --test test/*.test.js`: **1,983件中1,952件成功・失敗0・31スキップ**（エミュレータ専用）。公開時の predeploy でも同じ結果
  - 規則: 30文字、禁止表現、性的な言葉の拒否（全角半角の揺れを含む）、普通のカタカナ語は通ること
  - 実行: カードと年齢確認が必要、出すと掲示板の先頭に来る、掲示板と詳細に出る、1日3回、消しても回数は戻らない、翌日に戻る、24時間で消える
  - 画面: サーバーと同じ判定、入力欄はカードのある管理人だけ、掲示板の吹き出し、出す・消すの呼び出し
- firebase-tools の `listFiles` で公開対象を数え、106ファイル（新規なし）で `.claude`・Git 管理外のファイルを含まないことを確認
- 公開前に、本番3経路の `index.html` が `origin/main`（`8d970b4`）と一致し、`tributeAction` が前回のソースハッシュ（`a9e18c4…`）のままであることを確認
- 見本（幅375px）で、出す（性的な言葉の拒否、3回で入力欄が止まる、消しても回数が戻らない）と、掲示板・詳細の吹き出しを確認

## 本番反映結果

- Functions・push・Hosting はユーザーが手元の PowerShell で実行した。Functions は `tributeAction` の「Successful update operation」で「Deploy complete!」、push は `8d970b4..3c44933`、Hosting は106ファイルで「release complete」。警告は以前からある firebase-functions の版の案内だけ
- `functions:list`: 36関数すべて ACTIVE。公開前と比べて変わったのは `tributeAction`（新しいソースハッシュ `c32541bec7e090a02493b415805e41fab441ea94`）だけ
- workers.dev の自動ビルド（Workers Builds: gazostadium）は success（確認時点で完了済み）
- `node functions/scripts/verify-tribute-word-release.cjs`（読み取りのみ）: 3経路すべてで `index.html`・`tribute.js`・`tribute.css`・`tribute-core.mjs` が `3c44933` と一致し、変更のない `tribute-share.mjs` も一致（改行を揃えて比較）。前回までの公開の印（`ranch-collar-v1`・`ranch-gohoubi-v1`・`tribute-cost-guard-v1`・`retire-free-table-v1`）が残り、`TRIBUTE_DESIGN.md`・`firebase.json`・`functions/tribute-service.js`・`functions/tribute-rules.js`・確認スクリプト・`.claude/mocks/` のモック2ページが404
- 本番（workers.dev）の内蔵ブラウザで、新しいキャッシュキーの3ファイルと `tribute-share.mjs` が読まれ、お貢ぎ牧場のモジュールが初期化され、コンソールにエラーがないことを確認。牧場の中の操作（入場確認・カード作成・ひとことの投稿）は本番では行っていない

## 互換性と限界

- 本番の HTML は `Cache-Control: max-age=3600` のため、公開前に開いていた人は最大1時間ほど旧画面になりうる。旧画面には入力欄も吹き出しも出ないだけで、他の操作に影響はない
- 性的な言葉は決まった言葉の一覧で判定するため、わざと崩した書き方はすり抜けうる（通報・ブロックで対応）
- 2人での本番・エミュレータ通しの操作、iPhone／Android 実機・Safari での確認は行っていない
