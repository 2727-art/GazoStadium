# 戦略型1on1 貼り合い本式（v3）公開（2026-09-30）

## 対応内容

戦略型1on1を、同時公開して画像パワーを比べるラウンド制から、「なりきり・弱点読み・画像＋言葉・自己申告の点数で権利が移る」貼り合い本式の手番制へ置き換えた。ユーザー判断により、戦略型は並走させずにそのまま置き換え、ランク戦（RATE）のまま、100点満点と80／85／90帯、指示はメニュー方式のみ、女の子なりきり前提とした。仕様は `STRATEGY_HARIAI_DESIGN.md`（Hosting公開対象外）を正本とする。

- 実装コミット: `2734b0e`（origin/main）
- プロトコル: v3。キュー状態 `waiting-v3`／`offering-v3`。v2 の要求には Callable が「新しいルールになりました。再読み込みしてください」を返す
- 既存の戦略型戦績・RATE・総合ランキング・実績は移行・削除していない

## 配信対象

- Functions: `playerSafetyAction`（v3 のプレイヤー記録とルーム作成）、`economyAction`（デイリー集計の0〜100点対応）、`cleanupPlayerSafety`（同じ戦略型マッチング処理を利用）。ほかの33関数は対象外
- Realtime Database Rules: 戦略型ルームのスロット形式、候補ごとのコミット、罰、キュー・オファー・公開presenceの v3 状態、チャットの手番番号
- Hosting: `strategy.js`、`strategy.css`、`strategy-hariai-core.mjs`、`index.html`（キャッシュキー）、`app.js`（トップの説明文）。`firebase.json` で設計書を公開対象外にした
- Firestore Rules／Indexes は対象外

公開順は Functions → Database Rules → Hosting。Functions 公開から Hosting 公開までの間、旧画面の戦略型は再読み込みを促す表示になりマッチングできない。公開時点で戦略型のプレイヤーはいない前提。

## 公開前の検証

- `npm run check`（Node.js 24.15.0）: **1,585件中1,560成功・失敗0・25スキップ**（スキップはエミュレータ専用）
- Database エミュレータ: v3 ルール実評価、マッチング復旧、公開presence、Player Safety 戦略型（Firestore併用）がすべて成功
- ローカルの Auth／Database／Firestore／Functions／Hosting エミュレータで、別オリジンの2プレイヤーによる2試合を最後まで実施。マッチング、匿名紹介、封印、質問・指示・連投、候補の否定、看破の成功と失敗、仕留め、採点と同時の降参、連投による陥落、戦績・RATE反映、罰の選択と実行、品評会でのお貢ぎを確認した。検証中に見つけた3点（途中段階の手札表示、再描画時の登場アニメーション、スマホの手札の大きさ）は修正済み

## 本番反映結果

- 実装コミット `2734b0e` を origin/main へ push 後、Functions → Database Rules → Hosting の順で公開した。公開直前に、別セッションのデスクトップ版レイアウト修正 `44c619e` が同じ作業フォルダでコミット・公開済みだったことを確認した。今回のコミットはその上に積んであり、相手の変更を巻き戻していない
- Functions: 公開前チェック（`npm run check`）は **1,585件中1,560成功・失敗0・25スキップ**。`playerSafetyAction`・`economyAction`・`cleanupPlayerSafety` の3関数だけがハッシュ・ソース世代とも更新され、いずれも ACTIVE / Node.js 22。ほかの33関数は公開前とハッシュ・世代が一致した
- Database Rules: 構文検査後に公開。本番から取得したルールが手元の `database.rules.json` と完全一致し、戦略型ルームの `protocolVersion` 検証が `=== 3` になっていることを確認した
- Hosting: 新規アップロード5ファイル。web.app・firebaseapp.com・anjugames.workers.dev の3経路で、`index.html`・`strategy.js`・`strategy.css`・`app.js`・`strategy-hariai-core.mjs` が手元と一致した
- workers.dev 経路はリポジトリから別に配信されており、`.assetsignore` に設計書が未登録だったため、公開直後は `STRATEGY_HARIAI_DESIGN.md` が 200 で取得できた。`2a8a6e4` で除外に追加し、再ビルド後に 404 を確認した。Firebase の2経路は最初から 404。`database.rules.json` と `functions/` 配下も3経路とも 404
- 内蔵ブラウザで本番トップを表示し、新しい `strategy.js`・`strategy.css`・`strategy-hariai-core.mjs` が 200 で読み込まれ、トップの説明文が更新されたことを確認した。コンソールのエラーは、内蔵ブラウザで App Check（reCAPTCHA）のトークン交換が 403 になったことと、それに伴う公開統計2関数の 401 だけで、今回の変更とは無関係
- 本番では戦略型の画面を開かず、実対戦も行っていない（匿名アカウント作成と本番戦績への記録を避けるため）。対戦フローはローカルのエミュレータで確認済み
- 公開後の Functions ログは、`firebase functions:log` が Google Cloud からの取得に失敗したため確認できていない

詳細なハッシュと照合結果は `STRATEGY_HARIAI_QA.json` に保存した。戦略型戦績、RATE、総合ランキング、報酬、決済データの移行・削除は行っていない。

## 限界

- 本番の認証付き Callable を通した実対戦は行っていない
- iPhone／Android 実機、Safari での確認は行っていない
- 返答が遅い時の自動タイムアウトはなく、対戦中の再読み込みからは再開できない（従来と同じ）
- workers.dev 経路は GitHub の main への push で自動配信されるため、Functions 公開前の数分間は新しい画面と旧 Functions の組み合わせになっていた（戦略型は再読み込み表示またはマッチング不可になるだけで、データへの影響はない）
