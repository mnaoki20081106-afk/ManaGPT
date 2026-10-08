# manaGPT 初回セットアップ・完成チェックリスト（iPhone対応）

最終確認：2026-10-08。**CI（Tests / Agent Quality Gate）は成功**していますが、**Cloudflareへの自動デプロイの旧チェック記録では失敗**しています。コードのCI成功と本番動作は別です。

## まず用意するもの
- GitHubアカウント（このリポジトリを編集できる権限）
- Cloudflareアカウント（無料枠から開始可能）
- 指定モデルを動かすGPU推論サーバー（vLLMなど）と、そのHTTPSエンドポイント
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
2. WorkersをデプロイできるAPI Tokenを作成する（Edit Cloudflare Workersなどをベースにする）。**Global API KeyではなくAPI Token**を使用する。
3. **対象アカウントを限定**する。必要な権限はWorkersの作成・デプロイと **Account → D1 Edit**。新しいWorkerを作る場合はWorkers製品のAdmin権限が必要になる場合がある。
4. 発行したAPI Tokenを安全に保管する。画面を閉じると再表示できないことがあります。

## STEP 3 — GitHub Actions Secretsを登録（現在の最優先）
1. https://github.com/mnaoki20081106-afk/ManaGPT/settings/secrets/actions を開く。
2. **New repository secret** を押し、次の2つを別々に登録する。
   - `CLOUDFLARE_API_TOKEN`：STEP 2のAPI Token
   - `CLOUDFLARE_ACCOUNT_ID`：STEP 1のAccount ID
3. https://github.com/mnaoki20081106-afk/ManaGPT/actions/workflows/deploy-cloudflare.yml を開き、**Run workflow → Run workflow**。
4. 緑色のチェックが付くまでログを確認。失敗したら原因を確認してから再実行。

**2026-10-08修正：** ワークフローがCloudflare API Tokenを事前検証し、D1を自動検出・必要なら新規作成し、一時的なWrangler設定へ正しい `database_id` を注入します。GitHubでDatabase IDを手作業で編集する必要はありません。

## STEP 4 — D1データベース（自動準備）
1. デプロイの `Check credentials and prepare D1 binding` ステップで、API Tokenの有効性を確認します。
2. 同じCloudflareアカウントに `managpt` というD1データベースが存在する場合は再利用します。なければ作成します（D1 Edit権限が必要）。
3. 発行されたDatabase IDは一時的な `wrangler.deploy.jsonc` に自動的に適用され、リポジトリには保存されません。
4. Deploy Workerの成功後、CloudflareのWorkers設定で `DB` バインディングを確認してください。
5. 会話用テーブルは、初回APIアクセス時にコード側で作成されます。

## STEP 5 — 専用のQwen3-8B-Jailbroken推論エンドポイントを登録
1. [cooperleong00/Qwen3-8B-Jailbroken](https://huggingface.co/cooperleong00/Qwen3-8B-Jailbroken) の重みを、GPUマシン上のOpenAI互換サーバー（vLLMなど）で起動します。これはモデルのダウンロードページであり、実行中APIではありません。指定モデルはHugging Faceの公開Inference Providerから提供されていません。
2. エンドポイントが外部からHTTPSで利用できるようにし、認証とアクセス制御を設定します（URLは `https://YOUR-ENDPOINT/v1` の形式）。
3. Cloudflareの **Workers & Pages → managpt → Settings → Variables and Secrets** で次を設定します。
   - `MANAGPT_INFERENCE_BASE_URL`：HTTPSのモデルAPIベースURL（`/v1`で終わる）
   - `MANAGPT_INFERENCE_API_KEY`：APIトークン（**Secret**）
   - `MANAGPT_ACCESS_TOKEN`：アプリログイン用の長いトークン（**Secret**）
4. `MANAGPT_MODEL` は `wrangler.jsonc` で `cooperleong00/Qwen3-8B-Jailbroken` に設定済み。推論サーバーでも同じモデルIDを使うよう `--served-model-name` を指定します。
5. `GROQ_API_KEY` は**通常のテキスト生成には使用しません**。画像処理専用の `MANAGPT_VISION_MODEL` を使う場合のみ、その画像対応プロバイダー用に別途設定します。

> **費用と動作について：** Cloudflare Workers側だけではこの8Bモデルを推論できません。GPUホスティングには料金が発生する場合があります。エンドポイント未設定時は、別モデルに勝手に切り替えず設定エラーを表示します。実際のモデル応答はサーバーを稼働させてから検証してください。

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
- [ ] Cloudflareの有効なAPI TokenへGitHub Secretを更新しデプロイを成功させる
- [x] CIでD1の検出・作成・バインディング設定を自動化（本番未検証）
- [ ] Qwen3-8B-Jailbroken専用エンドポイントと認証をCloudflareに設定し、本番チャットを検証する
- [ ] iPhone Safariで複数チャット・履歴・ストリーミングのE2E確認
- [ ] Webリサーチの本番APIキー・料金・品質・SSRF対策を確認
- [ ] Torを安全に隔離した環境で起動し、漏洩テストを行う
- [ ] Tor専用APIをmanaGPTの画面に接続する
- [ ] UIのアクセシビリティ・エラー復旧・連投防止を実機検証する

## トラブルシューティング
- **Cloudflare 9109 `Invalid access token`**：Secretは読み込まれていますがCloudflareが認証できていません。Cloudflareで新しいAPI Tokenを発行し、GitHub Actionsの `CLOUDFLARE_API_TOKEN` を置き換えてください。値はチャットに貼らないでください。
- **Cloudflare 10000/403**：Account IDと、そのアカウントに対するWorkersおよびD1の権限を確認。
- **GitHub Actionsが失敗**：Actionsログの最初のエラーを確認。Secrets未登録、D1設定、API Token権限を順に点検。
- **401 Unauthorized**：アクセス用トークンを確認。
- **503**：CloudflareのSecretまたはDBバインディング不足。
- **502**：専用GPU推論エンドポイント、認証トークン、モデルロード、API応答の状態を確認。
- **会話が保存されない**：D1の `DB` バインディングとWorkerログを確認。
- **ストリーミングが止まる**：専用Qwen推論サーバーのレスポンス、Workerログ、ネットワークを確認。中断した応答は保存されない場合があります。

## 料金の目安
無料枠から開始できますが、Cloudflare Workers/D1・Brave Searchにはそれぞれ利用制限があります。指定モデルをホストするGPUには別途費用がかかることがあります。料金体系は変更されるため、最新条件を確認してください。Torサイドカーも別途ホスティングが必要になる場合があります。
