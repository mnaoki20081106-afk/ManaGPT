# manaGPT：iPhoneだけでも進められる初回セットアップ

**最新版の詳細手順：** [初回セットアップ・完成チェックリスト](../SETUP_TUTORIAL_JA.md)。こちらを優先してください。

**目的：** ManaGPTの全テキスト推論を`huihui-ai/Huihui-Qwen3-Coder-Next-abliterated`（80B）だけに固定します。このモデルを動かす推論エンドポイントが必要です。旧モデルには戻りません。

## セットアップ：CloudflareとモデルAPI

1. [Cloudflare](https://dash.cloudflare.com/sign-up) に登録します。指定モデルを使うには、[Hugging Faceのモデル](https://huggingface.co/huihui-ai/Huihui-Qwen3-Coder-Next-abliterated)を動かすGPU環境とOpenAI互換HTTPS APIを用意します。公開Inference Providerには未配備です。正確なモデルをホストするGPUサーバーを準備してください。
2. Cloudflareの [API Tokens](https://dash.cloudflare.com/profile/api-tokens) で **Edit Cloudflare Workers** 等を参考にAPI Tokenを作成。Workersの作成・デプロイ権限と **D1 Edit** を付与し、対象アカウントを限定。**Global API Keyを設定しない**。Account IDも控える。
3. GitHubの [manaGPT Actions secrets](https://github.com/mnaoki20081106-afk/ManaGPT/settings/secrets/actions) に **CLOUDFLARE_API_TOKEN** と **CLOUDFLARE_ACCOUNT_ID** を追加する。秘密値はチャットやリポジトリのファイルには貼らない。
4. [Deploy Cloudflare](https://github.com/mnaoki20081106-afk/ManaGPT/actions/workflows/deploy-cloudflare.yml) を開き、**Run workflow** → **Run workflow**。完了したらCloudflareのWorkers & Pagesで `managpt` を開く。最新版ワークフローはAPI Tokenを事前検証し、D1の既存DBを再利用（なければ自動作成）し、一時的なWrangler設定に `database_id` を適用します。
5. Cloudflare Workersの `managpt` → Settings → Variables and Secrets に **MANAGPT_ACCESS_TOKEN**、**MANAGPT_INFERENCE_BASE_URL**（`https://YOUR-ENDPOINT/v1`）と **MANAGPT_INFERENCE_API_KEY**（Secret）を設定します。旧モデル・旧推論プロバイダーは使用しません。
6. Workersの **workers.dev** URLをSafariで開き、MANAGPT_ACCESS_TOKENを入力して接続。会話できれば完成。Safariの共有メニュー → **ホーム画面に追加**。

**2回目以降：** mainブランチのCloudflare関連コードを変更するとGitHub Actionsが自動デプロイします。パスワードやAPIキーを変更したいときはCloudflareダッシュボードでSecretを更新します。

## チャットでファイル添付・GitHubリポジトリ選択

- チャット入力欄の **＋ 添付** またはドラッグ＆ドロップからファイルを選択します。テキスト・コード・CSV・JSON等は1件1MB以下、文字抽出可能なPDFは12MB以下、画像は1枚1.6MB以下です。最大4ファイル（画像2枚）まで。PDFはブラウザ内でPDF.jsを使って文字抽出するため、スキャンPDFはOCR処理が別途必要です。大きな文書は最大約3万文字まで抽出し、PDF.jsのライブラリはcdnjs経由で読み込みます。
- 添付本文は、会話の内容としてD1に保存され、次のターンでも参照されます。画像のデータ自体は履歴に保存しません。**現在のモデルは画像入力に対応していないため、画像付きメッセージを送ると未対応エラーになります。テキストまたは文字抽出したPDFを使用してください。
- ManaGPTの **設定・接続 → GitHub連携** で、GitHubの [Fine-grained Personal Access Token](https://github.com/settings/personal-access-tokens/new) を入力し「GitHubに接続」を押します。選択するリポジトリに対して **Contents: Read and write / Pull requests: Read and write / Actions・Checks: Read** の権限を設定します（PRステータス取得に追加の読み取り権限が必要になる場合があります）。GitHub側で許可したリポジトリだけが候補に表示されます。
- リポジトリの一覧から開発対象を選び「このリポジトリを使用」を押します。コーディングエージェントは以後そのリポジトリにPRを作成します。トークンはD1にAES-GCM暗号化保存し、暗号鍵は `MANAGPT_ACCESS_TOKEN` から導出します。**MANAGPT_ACCESS_TOKENを変更した場合はGitHub連携を設定し直してください。** 既存の `GITHUB_TOKEN` と `GITHUB_REPOSITORY` は未設定時の互換用で、設定画面の接続が優先されます。
- 設定画面の「連携解除」で保存トークンとリポジトリ選択を消去します。GitHub側のトークン自体を失効させる場合はGitHubの設定ページからRevokeしてください。

## 失敗したとき
- GitHub Actionsが `Invalid access token [9109]` で失敗: **Secretは存在しているがトークンが無効**。Cloudflareで新しいAPI Tokenを作り、GitHub Actions Secret `CLOUDFLARE_API_TOKEN` を置き換える。APIキーを会話に貼らない。
- `10000/403`: 対象アカウントとWorkers・D1の権限を確認。
- `503`: 指定モデルを動かす専用推論サーバーの`MANAGPT_INFERENCE_BASE_URL`と`MANAGPT_INFERENCE_API_KEY`を確認。
- 接続後は設定画面の「現在の推論モデル」でHuihuiモデルの状態を確認してください。
- `401`: MANAGPT_ACCESS_TOKENを再入力。
- `502`: Huihui推論サーバーのAPIキー、URL、稼働状況、モデルロードを確認。
- `500`: D1バインディングの作成状況とWorkersログを確認。

## セキュリティと料金
- Cloudflare Workerは無料枠を利用可能ですが、80Bモデル用GPU/APIには別途費用が発生する可能性があります。
- workers.dev URLは公開URLです。トークン認証が必要なAPIでも、チャット画面自体は公開されます。
- この実装は個人用の簡易認証で、Cloudflare Access等の強化は未実装です。
- GitHub Actionsが通っても、専用Qwen推論エンドポイントとの本番接続・モデル識別・ストリーミング動作を実機で確認してください。
