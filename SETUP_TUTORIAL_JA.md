# manaGPT 初回セットアップ・完成チェックリスト（iPhone対応）

最終確認：2026-10-08。**CI（Tests / Agent Quality Gate）は成功**していますが、**Cloudflareへの自動デプロイは失敗**しています。コードのCI成功と本番動作は別です。

## まず用意するもの
- GitHubアカウント（このリポジトリを編集できる権限）
- Cloudflareアカウント（無料枠から開始可能）
- GroqアカウントとAPIキー
- Webリサーチを使うなら Brave Search APIキー
- GitHub開発エージェントを使うなら GitHub Personal Access Token（対象リポジトリに限定）
- iPhoneのSafari（Cloudflare / GitHubのデスクトップ表示に切り替えると設定しやすい場合があります）

**重要：APIキーやトークンをGitHubのコード・Issue・チャットに貼らないこと。**

## STEP 1 — Cloudflareに登録
1. https://dash.cloudflare.com/sign-up から登録してログイン。
2. Workers & Pages を開き、アカウントを確認。
3. Account IDを確認して控える。Account IDは秘密鍵ではありませんが、公開しない方が無難です。

## STEP 2 — Cloudflare API Tokenを発行
1. https://dash.cloudflare.com/profile/api-tokens を開く。
2. Workersをデプロイできるテンプレート（例：Edit Cloudflare Workers）を選ぶ。
3. **対象アカウントを限定**する。D1の作成・バインドに必要な権限も確認する。
4. 発行したAPI Tokenを安全に保管する。画面を閉じると再表示できないことがあります。

## STEP 3 — GitHub Actions Secretsを登録（現在の最優先）
1. https://github.com/mnaoki20081106-afk/ManaGPT/settings/secrets/actions を開く。
2. **New repository secret** を押し、次の2つを別々に登録する。
   - `CLOUDFLARE_API_TOKEN`：STEP 2のAPI Token
   - `CLOUDFLARE_ACCOUNT_ID`：STEP 1のAccount ID
3. https://github.com/mnaoki20081106-afk/ManaGPT/actions/workflows/deploy-cloudflare.yml を開き、**Run workflow → Run workflow**。
4. 緑色のチェックが付くまでログを確認。失敗したら原因を確認してから再実行。

**注意：現行の `wrangler.jsonc` はD1の `database_id` を指定していません。** GitHub Secretsを登録するだけで必ずデプロイできるとは限りません。D1データベースの作成・設定が必要になる可能性があります。

## STEP 4 — D1データベースを準備
1. Cloudflareダッシュボードの **Storage & Databases → D1**（UIの表記は変わる場合あり）を開く。
2. `managpt` というデータベースを作成する。すでに存在する場合は重複作成しない。
3. 表示された **Database ID** を控える。
4. GitHubの `wrangler.jsonc` の `d1_databases[0]` に、Cloudflareが発行した `database_id` を追加する（値は推測しない）。
5. GitHub Actionsで再デプロイし、Workerの `DB` バインディングが `managpt` に紐付いていることを確認する。
6. 会話用テーブルは、初回APIアクセス時にコード側で作成されます。D1の作成そのものは別作業です。

## STEP 5 — GroqのAPIキーを登録
1. https://console.groq.com/keys でAPIキーを発行。
2. Cloudflareの **Workers & Pages → managpt → Settings → Variables and Secrets** を開く。
3. `GROQ_API_KEY` を **Secret** として追加。
4. `MANAGPT_ACCESS_TOKEN` を **Secret** として追加。32文字以上の推測されにくいランダムな文字列を推奨。
5. 設定を保存・適用する。
6. モデル名は `wrangler.jsonc` の `MANAGPT_MODEL` で指定。現在の値 `qwen/qwen3.8-27b` は利用可能か未確認。Groqのモデル一覧で実在するモデルIDを確認して必要なら変更する。会話機能の新しいストリーミング処理には `qwen/qwen3-32b` のフォールバック指定がありますが、設定変数が優先されます。

## STEP 6 — Safariで接続
1. Cloudflareで `managpt` Workerの `*.workers.dev` URLを確認。
2. Safariで開き、**設定・接続**に進む。
3. STEP 5の `MANAGPT_ACCESS_TOKEN` を入力して **接続する**。
4. 接続後、チャットを送信し、AIの返答が少しずつ表示されるか確認。
5. 新しいチャットを作成 → 別の話題を送信 → サイドバーで切り替え → ページ再読み込み後も履歴が残るか確認。
6. 必要ならSafariの共有メニューから **ホーム画面に追加**。

## STEP 7 — Webリサーチを使う
1. Brave Search APIの利用登録を行い、APIキーを取得。
2. Cloudflare WorkerのSecretに `BRAVE_SEARCH_API_KEY` を追加。
3. manaGPTの **Webリサーチ** で質問を入力して実行。
4. 出典リンク、引用番号、本文取得件数を確認。
5. **引用番号の整合性チェックは、引用内容が正しいことの保証ではありません。** 重要な結論は元ページで確認してください。

## STEP 8 — GitHub開発エージェントを使う（任意）
1. GitHubで対象リポジトリに必要最小限の権限を持つトークンを発行。
2. Cloudflare Workerに `GITHUB_TOKEN` と `GITHUB_REPOSITORY=mnaoki20081106-afk/ManaGPT` を設定（後者は公開設定でも可）。
3. コーディング画面で小さな変更を依頼し、PRが作成されるか確認。
4. GitHub Actionsのテスト結果と差分を**必ず人間が確認**してからマージ。自動修復機能も実環境で要確認。

## STEP 9 — Tor（現状は別サーバー・試作）
- `tor/` に独立したTor v3 `.onion` HTML閲覧サーバーの試作コードがあります。
- **manaGPTのWeb画面とはまだ接続されていません。** Cloudflare Worker単体でTor SOCKSに接続する設計ではありません。
- 公開利用前にネットワーク分離、Tor以外への通信遮断、漏洩検証、API認証と濫用防止を実装・検証する必要があります。
- Torを使わない通常のチャット・リサーチを先に動作確認してください。

## 完成までの残作業（実装・検証担当）
- [x] ChatGPT風のレスポンシブUI
- [x] D1で複数チャットを分けるAPIとUI
- [x] SSEによる回答の逐次表示
- [x] リサーチUIと公開Web本文取得の試作
- [x] Tor独立サーバーの試作コード
- [x] 直近のNodeテストとAgent Quality Gateが成功
- [ ] Cloudflare Secretsを登録しデプロイを成功させる
- [ ] D1 Database IDとDBバインディングを確定する
- [ ] GroqモデルIDとAPIキーで本番チャットを検証する
- [ ] iPhone Safariで複数チャット・履歴・ストリーミングのE2E確認
- [ ] Webリサーチの本番APIキー・料金・品質・SSRF対策を確認
- [ ] Torを安全に隔離した環境で起動し、漏洩テストを行う
- [ ] Tor専用APIをmanaGPTの画面に接続する
- [ ] UIのアクセシビリティ・エラー復旧・連投防止を実機検証する

## トラブルシューティング
- **GitHub Actionsが失敗**：Actionsログの最初のエラーを確認。Secrets未登録、D1設定、API Token権限を順に点検。
- **401 Unauthorized**：アクセス用トークンを確認。
- **503**：CloudflareのSecretまたはDBバインディング不足。
- **502**：Groq APIキー、モデルID、レート制限を確認。
- **会話が保存されない**：D1の `DB` バインディングとWorkerログを確認。
- **ストリーミングが止まる**：Groqのレスポンス、Workerログ、ネットワークを確認。中断した応答は保存されない場合があります。

## 料金の目安
無料枠から開始できますが、Cloudflare Workers/D1・Groq・Brave Searchにはそれぞれ利用制限があります。料金体系は変更されるため、登録時に各公式ダッシュボードで最新条件を確認してください。Torサイドカーを常時稼働させる場合は別途ホスティング費用が発生する可能性があります。
