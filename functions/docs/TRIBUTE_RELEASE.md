# お貢ぎ界隈（2026-10-01）

## 対応内容

推し値市場（VALUE MARKET）を「お貢ぎ界隈 / OMITSUGI」に置き換えた。ユーザーの決定事項: 第3段まで実装／推し値市場は置き換えて終了／パトロン還元・循環基金は新しい形（上納と界隈基金）で作り直す／入場時に18歳以上の自己申告／定型文の辛口は徹底する（仕様にある除外は守る）。設計の正本は `TRIBUTE_DESIGN.md`（非公開）。

- 実装コミット: `1359f0a`（origin/main）
- 第1段: 入場時の年齢と前提の確認、管理人カード（画像なし・中の人の札・管理の型・入場料・印の色）、掲示板（絞り込みは「ネカマ開示のみ」だけ）、申し込み・受理・断る・取り下げ、預ける側だけが決める上限（1回・1日・合計）・期間・言葉の強さ・言われたくない言葉、上限の即時引き下げと翌日0時からの引き上げ、いつでも即時の解約
- 第2段: 請求→確認→長押しで差し出す→財布が開く→レシート、管理口座（預け入れ・使用許可・徴収・終了時の全額返還）、参加者だけが読める即時スレッド、連絡先・外部決済・会う約束・個人情報・晒し・言われたくない言葉の送信拒否、言葉の強さ別の定型文、残高報告、通報、ブロックで契約終了
- 第3段: 上納（80%消却・20%界隈基金）、基金による献上手数料の補填、称号3段階、推薦棚、方針投票、管理人番付、管理人ごとの番付、貢ぎ帳
- 推し値市場: 新規待機（`join`）をサーバーで拒否。進行中の商談は従来どおり完了・返還まで処理。旧パトロンの昇格・還元と方針投票を停止し、記録の閲覧だけ残す

## 配信対象

- Firestore インデックス: お貢ぎ界隈用の複合インデックス9件を追加（既存は変更なし）
- Firestore ルール: `tributeContracts` と `events` は契約の参加者だけが読める。ほかの `tribute*` はクライアントから読み書き不可
- Functions: 全38関数。新規 `tributeAction`（App Check 必須）と `expireTributeContracts`（15分ごと）。`valueMarketQueue`（join 停止）・`economyAction`（パトロン停止）・`playerSafetyAction`（ブロック時に契約終了、tribute の相手解決）も挙動が変わる
- Hosting / workers.dev: `index.html`（キャッシュキー `tribute-v1`）、新規 `tribute.js`・`tribute.css`・`tribute-core.mjs`、`app.js`・`account.js`・`market.js`・`market.css`・`velvet.css`、他モードの排他確認を足した `ai-text-training.js`・`danwaku-note.js`・`flea-market.js`・`free-table.js`・`online.js`・`roulette-training.js`・`strategy.js`
- 非公開: `TRIBUTE_DESIGN.md` を `firebase.json` hosting.ignore と `.assetsignore` の両方へ追加

## 公開前の検証

- `node --test test/*.test.js`（Node.js 24.15.0）: **1,661件中1,636件成功・失敗0・25スキップ**（スキップはエミュレータ専用）
  - 新規34件: `tribute-rules.test.js`（禁止表現・上限・手数料・補填・称号・日付）、`tribute-service-runtime.test.js`（年齢確認、入場料、上限、冪等、上限変更、管理口座、ブロック、期限切れ、件数上限、1日の受取上限、上納と補填、番付、通報、未読）、`tribute-client.test.js`（入口・排他・預ける側の操作・クライアントとサーバーの判定一致・定型文の除外・配線・ルール・インデックス・非公開設定）
  - 廃止したパトロン画面や旧キャッシュキーに結び付いた既存テスト8件を新しい仕様に合わせて更新
- 見本（`?tributePreview=`）12画面: 幅320px・375pxで横はみ出し・スクリプトエラーなし。確認シートとレシートは、画面要素のアニメーションの影響を受けないよう body 直下の層に置いた
- ローカルの Auth／Database／Firestore／Functions／Hosting エミュレータで2人を通しで操作:
  - 入場確認→カード作成→掲示板（ネカマのみ）→申し込み（100／300／1,000・3日・辛口・NG「ブス」）→受理で入場料10 Pay（受取9 Pay）
  - 会話、言われたくない言葉・外部連絡先の拒否、100 Payの請求と長押しでの支払い、レシート
  - 管理口座200 Pay→使用許可50 Pay→徴収30 Pay→上限の引き下げと引き上げ予約→残高報告→解約で残り120 Payが即時返還（預ける側 5,000→4,860、管理人 132 Pay）
  - 画面を通さない直接呼び出しでも、管理人の上限変更・解約、NG語、外部決済の語、上限超えの請求はサーバーが拒否
  - 再契約（続く管理）の後、管理人がスレッドからブロックすると契約は `blocked` で終了し、件数は0に戻り、掲示板から消えた
  - 旧市場の `join` とパトロン昇格は終了メッセージで拒否

## 本番反映結果

- Firestore インデックスを先に公開した。続く Firestore ルールの公開は Claude Code の権限確認で止まったため、ルール・Functions・Hosting はユーザーが手元の PowerShell で実行した
- 最初の実行では、案内したコマンドが Bash の変数（`$LOCALAPPDATA`）を使っていたため Functions と Hosting が起動できず、main への push だけが通った。その間、workers.dev だけが新しい画面・旧サーバーの組み合わせになり、お貢ぎ界隈を開くと接続エラーになる状態だった（データの破損はない）。絶対パスのコマンドで再実行して解消した
- Functions: 38関数すべて成功（`tributeAction`・`expireTributeContracts` は新規作成）。Hosting: 85ファイルで公開完了
- 3経路（web.app・firebaseapp.com・anjugames.workers.dev）で、変更した16ファイルが `1359f0a` と一致（Firebase Hosting は作業コピーの CRLF、workers.dev は git の LF で配信されるため、改行を揃えて比較）。`TRIBUTE_DESIGN.md`・`README.md`・`firebase.json`・`firestore.rules`・`firestore.indexes.json`・`functions/` 配下・`functions/test/` 配下・`.claude/launch.json`・`.assetsignore` は3経路とも404（30項目）
- 本番の内蔵ブラウザで3経路とも、トップの「お貢ぎ界隈」から入場確認画面まで開いた（`tributeAction` と App Check が通ることの確認）。コンソールのエラーなし
- 本番の Firestore で、自分が参加者の契約一覧（参加者＋更新時刻のクエリ）が読め、他人の契約と `tributeProfiles` は拒否された。新しいルールと複合インデックスが効いていることの確認
- 本番で旧市場の `join` とパトロン昇格を呼ぶと、終了メッセージで拒否された
- 本番では入場確認・カード作成・申し込みなどの書き込みは行っていない

## 互換性と限界

- 本番の HTML は `Cache-Control: max-age=3600` のため、公開前に開いていた人は最大1時間ほど旧画面が残りうる。旧画面から推し値市場の待機やパトロン昇格を押すと、サーバーが終了メッセージを返す。進行中の商談は旧画面でも新画面でも最後まで処理できる
- 期限切れの後始末は15分ごとの定期実行と、画面を開いた時の個別処理の二重で行う。定期実行は本番で初回の実行をまだ確認していない
- 上納（Google 保護が必要）と基金の補填は単体テストでだけ確認した
- iPhone／Android 実機、Safari での確認は行っていない
