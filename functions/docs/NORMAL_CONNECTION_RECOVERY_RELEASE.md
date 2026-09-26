# 通常1on1 接続復旧修正（2026-09-26）

## 対応する問題

Cloudflareの正常なTURN応答に含まれるUDP443を拒否し、有効なTCP/TLS候補も含めて失っていた。通常1on1の初期接続でも、presence更新やoffer作成・送信の失敗後にconnectingと自己予約が残る経路があった。

調査基準は `68b43e77ac561cd1fe9d9903ae1b45cfdeb53964`。9月24日の公開は主に待機復旧・エラー分類の修正で、今回の2点を修正していなかった。ユーザーの追加承認により、実装・本番公開までを今回の対象とする。

## 中継接続の互換性

- Cloudflare公式のUDP443を上流応答の許可対象へ加える。
- 全URL・host・資格情報を厳格に検査してから、既に開いているクライアント向けに正確なUDP443候補だけを配送対象から外す。未知hostや不正な候補を黙って受け入れる変更ではない。
- 現在の公式応答ではUDP3478、TCP3478／80、TLS5349／443の5候補を保持する。STUNとTURNの両方が残ることを必須とする。
- 旧online.jsとmarket.jsの実検証関数でも受信できる構成を返し、共通loaderを利用する自由卓も互換性を保つ。資格情報の発行期間や秘密は変更しない。

## 接続準備中の復旧

- connectingに入った時点から30秒の初期設定監視を開始する。presence更新、リスナー準備、TURN取得、peer／offer作成・送信の例外や停止を、既存のP2P復旧処理へ渡す。
- 古い試行を無効化してから接続を閉じ、遅れた処理が次のpeerや待機情報へ書き込まないようにする。
- 自分のsession/token/generationに対する終了処理の応答を確認する。通信が止まっている間は15秒で確認待ち画面を表示し、実行中の終了処理を保持して、新しい対戦開始と競合させない。
- 終了処理の確定した失敗には最大3回の再試行を行う。なお失敗する場合は「もう一度試す」から再確認できる。所有権を失った応答を部屋削除成功と同一視せず、自動再待機を止めてサーバーの通常参加判定へ戻す。
- 確定済みの結果と両者採点済みのラウンドを保護する。結果の取得が確認できない場合も、強引に破棄せず確認待ちへ進める。別画面との排他条件やデータベース権限は緩和しない。

## 公開と検証

- 別作業を保護するため、専用worktreeの `codex/normal-connection-recovery-20260926` を使用する。
- 配信対象は `getP2pIceServers` とFirebase Hosting。その他Functions・Realtime Database Rules・FirestoreのRules/Indexesは対象外。
- 回帰検証は新旧Cloudflare構成、実ブラウザー側検証、許可外URL拒否、接続例外・時間切れ・後片付け・古い処理との競合を含む。
- 実ブラウザーでは `normal-turn-browser.html` をローカルで表示し、2つのRTCPeerConnectionを `iceTransportPolicy: relay` に固定して、Cloudflare経由の4096バイト往復とSHA-256一致を確認する。実プレイヤーと対戦せず、秘密値や一時資格情報を証拠ファイルへ保存しない。
- 公開後は関数のACTIVE・Node.js22・リビジョンと認証境界を確認し、Firebase2経路とWorkers経路のHTML参照ファイルを取得して一致を照合する。
- テスト・fixture・この記録はfunctions配下にあり、Hosting公開対象外。

公開前の最終検証は Node.js 22.23.2 の `npm run check` で **1,545成功・失敗0・25スキップ**。スキップは明示的なエミュレーター起動を必要とする検査で、通常1on1のRTDB権限検査は別途実際のエミュレーターで **14成功・スキップ0** を確認した。今回の実関数を実行する接続復旧回帰は **22成功**、TURN関連の集中検証は **23成功**。setupとcleanupを別担当でレビューし、検出した遅延処理の競合・再試行停止・初期化falseの取りこぼしは修正後に独立再検証した。

実ブラウザーの中継専用試験は2026-09-26 14:25:52 UTCに成功。両端でrelay経路、4096バイトの往復とSHA-256一致を確認した。これは実Cloudflare応答を修正後validatorに通すローカルfixtureの検証で、本番認証付きcallableを通した試験ではない。

## 本番反映結果

- 実装コミット: `f1bf93797ec68ae932bd7972d2ec417417396a60`。origin/mainへpush後、Function、Hostingの順で公開した。
- `getP2pIceServers` は2026-09-26 23:45:56 JSTに更新され、`getp2piceservers-00005-wab` がACTIVE / Node.js22。未認証要求は従来どおり401 / UNAUTHENTICATEDを返す。36関数のハッシュを公開前と比較し、変更は対象1関数のみ、ほか35関数は一致した。
- 2026-09-26 23:47:12 JST、web.app・firebaseapp.com・anjugames.workers.devの全3経路で、通常のルートURLから参照されるHTML、online.js、P2P復旧module、session guardのローカル一致を確認した。非公開対象4パスの404を含む **24項目すべて成功**。
- Workers経路の実ブラウザーで、ホーム→通常1on1準備→Firebase接続完了→ホーム復帰を確認した。更新後script参照、console error 0件、実対戦は開始していない。
- 23:48:06 JST時点の更新後Functionログ15件には、正常なHTTP200応答4件、CORS応答204が4件、検証用未認証401が1件あった。`invalid_response` は0件。短時間・匿名集計であり、報告者本人の再現解消を示す観測ではない。
- 最初のCLI実行は専用worktreeのdotenv不足でアップロード前に終了。元の公開環境にある `ANJU_PAY_LEDGER_REQUIRED=true` を、Git対象外の専用dotenvへ引き継いで成功した。

詳細なハッシュ・時刻・回帰結果は `NORMAL_CONNECTION_RECOVERY_QA.json` に保存した。今回の変更は上記FunctionとHostingに限定し、Rules、対戦結果、ランキング、報酬、決済データを移行・削除していない。

## 限界

iPhone／Brave実機での確認は行っていない。実ブラウザーの中継試験は使用したWindowsブラウザーと回線での結果であり、あらゆるモバイル回線を保証しない。接続準備の新しい復旧処理にはページ更新が必要。
