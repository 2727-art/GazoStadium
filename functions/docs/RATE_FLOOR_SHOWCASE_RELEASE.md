# 下限チャレンジのSIGNATURE・実績表示

## 仕様

- 通常の総合ランキングと同じ選択済みSIGNATURE・王座色・公開実績ショーケースを下限チャレンジに表示する。
- 実績は最大3件。FINAL・SECRET・SPECIALの既存装飾を共用する。敗北・シークレット実績の手動公開条件を維持する。
- 公開参加、検証済み10戦以上、低RATE順の最大10席、同RATE同順位を維持する。下限順位による追加報酬・専用実績の付与はない。
- 画面上の名前・試合数・RATEの下段に装飾を配置する。モバイルでは装飾に行全幅を使い、実績名を折り返す。
- 設定保存後に下限・総合・表示中の期間ランキングを再取得する。再取得失敗は保存成功を取り消さず、既存のエラー表示・再取得ボタンで回復する。

## データ同期

Firestoreのランキングプロフィールと実績プロフィールを同じtransactionで読み、現在の公開実績を再計算する。公開実績の変更時とSIGNATURE・王座色の設定時に下限ミラーのrevisionを進め、RTDBの比較更新で遅延した古い配送を拒否する。設定取り下げ時に古いプロフィールのfallbackからSIGNATURE・実績を復活させない。

`scripts/sync-rate-floor-showcase.js` は既存の可視下限レコードだけを正本から再同期する。標準はdry-run、書込みは `--project gazostadium --apply` が必要。Firestore transactionのコミット後にRTDB ETag CASを行い、非公開化・削除・より新しいrevisionを保護する。ログは件数だけで、UID・名前・認証情報は出力しない。

## デプロイ対象

Hostingと、変更した実績同期・対戦確定・公開設定ヘルパーを利用する以下の9 Functionsを対象とする。

`economyAction`, `redeemAchievementCode`, `playerSafetyAction`, `cleanupPlayerSafety`, `valueMarketAction`, `danwakuNoteAction`, `aiTextTrainingAction`, `rouletteTrainingAction`, `valueMarketRankings`。

Rules・Indexesの変更はない。元の作業ツリーを保全し、`origin/main` の `fdd2cdb` から作成した分離worktreeで実装した。

## 公開前検証

- Node 22 の `npm run check`: 1,464 tests / 1,441 pass / 0 fail / 23 skip。スキップは環境条件付きテスト。
- 下限のRTDB RulesはFirebase Database Emulatorで別途実行し、1 pass / 0 fail / 0 skip。公開読取りとクライアント書込み拒否を確認。
- 秘密実績の公開選択・取り下げ、SIGNATURE解除、対戦／公開停止との競合、古い配送の拒否、移行再実行とETag競合をfixtureテストで確認。
- 実際の画面コードに合成データを渡すブラウザQAで1440×1000・390×844・320×568を確認。横はみ出し0、JavaScript例外0。gold/aquaの選択色、FINAL/SECRET/SPECIAL、装飾未設定、同順位、空表示とエラー時の再取得を確認。これは本番ユーザーの設定変更試験ではない。
- `RATE_FLOOR_SHOWCASE_UI_QA.json` と `rate-floor-showcase-*.png` に画面検証を保存。

## 本番検証

本番デプロイ後の結果をここへ追記する。配信検証は3ドメインの実参照URLとキャッシュ回避URL、Content-Type、HTTP、LF正規化SHA-256、非公開ファイルの404を照合する。FunctionsはACTIVE/runtime/revision/更新時刻、無認証呼出しの401拒否、指定時間範囲の起動・エラーログを確認する。
