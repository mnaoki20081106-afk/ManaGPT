# manaGPT：iPhoneだけでも進められる初回セットアップ

**最新版の詳細手順：** [初回セットアップ・完成チェックリスト](../SETUP_TUTORIAL_JA.md)。こちらを優先してください。

**目的：** Cloudflare Workers + D1 にあるManaGPTから指定モデルに接続します。FeatherlessのAPIキー1つで指定モデルを使用でき、既存のGroqキーしかない場合は従来のGroqモデルで会話を続けられます。実際に使用中のモデルは設定画面に表示されます。

## セットアップ：CloudflareとモデルAPI

1. [Cloudflare](https://dash.cloudflare.com/sign-up) に登録します。指定モデルを使うには[Featherless](https://featherless.ai/models/cooperleong00/Qwen3-8B-Jailbroken)でAPIキーを発行するか、GPU環境にモデルをデプロイします。Featherlessの料金・利用条件は登録前に確認してください。Groqの既存APIでは指定モデルそのものは実行できません。
2. Cloudflareの [API Tokens](https://dash.cloudflare.com/profile/api-tokens) で **Edit Cloudflare Workers** 等を参考にAPI Tokenを作成。Workersの作成・デプロイ権限と **D1 Edit** を付与し、対象アカウントを限定。**Global API Keyを設定しない**。Account IDも控える。
3. GitHubの [manaGPT Actions secrets](https://github.com/mnaoki20081106-afk/ManaGPT/settings/secrets/actions) に **CLOUDFLARE_API_TOKEN** と **CLOUDFLARE_ACCOUNT_ID** を追加する。秘密値はチャットやリポジトリのファイルには貼らない。
4. [Deploy Cloudflare](https://github.com/mnaoki20081106-afk/ManaGPT/actions/workflows/deploy-cloudflare.yml) を開き、**Run workflow** → **Run workflow**。完了したらCloudflareのWorkers & Pagesで `managpt` を開く。最新版ワークフローはAPI Tokenを事前検証し、D1の既存DBを再利用（なければ自動作成）し、一時的なWrangler設定に `database_id` を適用します。
5. Cloudflare Workersの `managpt` → Settings → Variables and Secrets には **MANAGPT_ACCESS_TOKEN**（アプリ用パスワード）と、指定モデルを使う場合は **FEATHERLESS_API_KEY** をSecretとして登録します。独自GPUを使う場合は代わりに **MANAGPT_INFERENCE_BASE_URL**（`https://YOUR-ENDPOINT/v1`）と **MANAGPT_INFERENCE_API_KEY** を設定します。既存の **GROQ_API_KEY** しかない場合も旧Groqモデルで会話でき、画面に「従来モデル」と表示されます。
6. Workersの **workers.dev** URLをSafariで開き、MANAGPT_ACCESS_TOKENを入力して接続。会話できれば完成。Safariの共有メニュー → **ホーム画面に追加**。

**2回目以降：** mainブランチのCloudflare関連コードを変更するとGitHub Actionsが自動デプロイします。パスワードやAPIキーを変更したいときはCloudflareダッシュボードでSecretを更新します。

## チャットでファイル添付・GitHubリポジトリ選択

- チャット入力欄の **＋ 添付** またはドラッグ＆ドロップからファイルを選択します。テキスト・コード・CSV・JSON等は1件1MB以下、文字抽出可能なPDFは12MB以下、画像は1枚1.6MB以下です。最大4ファイル（画像2枚）まで。PDFはブラウザ内でPDF.jsを使って文字抽出するため、スキャンPDFはOCR処理が別途必要です。大きな文書は最大約3万文字まで抽出し、PDF.jsのライブラリはcdnjs経由で読み込みます。
- 添付本文は、会話の内容としてD1に保存され、次のターンでも参照されます。画像のデータ自体は履歴に保存しません。**画像でAIに質問するには** Cloudflare Workerの変数 `MANAGPT_VISION_MODEL` に、Groqアカウントで現在利用可能な画像入力対応モデルIDを設定してください。設定しない場合は画像付きメッセージの送信をエラーで止め、テキストのみのチャットには影響しません。
- ManaGPTの **設定・接続 → GitHub連携** で、GitHubの [Fine-grained Personal Access Token](https://github.com/settings/personal-access-tokens/new) を入力し「GitHubに接続」を押します。選択するリポジトリに対して **Contents: Read and write / Pull requests: Read and write / Actions・Checks: Read** の権限を設定します（PRステータス取得に追加の読み取り権限が必要になる場合があります）。GitHub側で許可したリポジトリだけが候補に表示されます。
- リポジトリの一覧から開発対象を選び「このリポジトリを使用」を押します。コーディングエージェントは以後そのリポジトリにPRを作成します。トークンはD1にAES-GCM暗号化保存し、暗号鍵は `MANAGPT_ACCESS_TOKEN` から導出します。**MANAGPT_ACCESS_TOKENを変更した場合はGitHub連携を設定し直してください。** 既存の `GITHUB_TOKEN` と `GITHUB_REPOSITORY` は未設定時の互換用で、設定画面の接続が優先されます。
- 設定画面の「連携解除」で保存トークンとリポジトリ選択を消去します。GitHub側のトークン自体を失効させる場合はGitHubの設定ページからRevokeしてください。

## 失敗したとき
- GitHub Actionsが `Invalid access token [9109]` で失敗: **Secretは存在しているがトークンが無効**。Cloudflareで新しいAPI Tokenを作り、GitHub Actions Secret `CLOUDFLARE_API_TOKEN` を置き換える。APIキーを会話に貼らない。
- `10000/403`: 対象アカウントとWorkers・D1の権限を確認。
- `503`: `FEATHERLESS_API_KEY`、`GROQ_API_KEY`、または専用推論サーバー用のURLとAPIキーのいずれかが設定されているか確認。
- 正しくログインできたら設定画面の「現在の推論モデル」で使用モデルが表示されます。Groq表示は指定モデルではありません。
- `401`: MANAGPT_ACCESS_TOKENを再入力。
- `502`: Featherlessまたは独自GPUのAPIキー、プラン利用資格、URL、稼働状況を確認。Groq使用時は従来のモデルIDを確認。
- `500`: D1バインディングの作成状況とWorkersログを確認。

## セキュリティと料金
- Cloudflare Workerは無料枠を利用可能ですが、指定モデルをFeatherlessまたは独自GPUで使う場合は利用料金が発生する可能性があります。
- workers.dev URLは公開URLです。トークン認証が必要なAPIでも、チャット画面自体は公開されます。
- この実装は個人用の簡易認証で、Cloudflare Access等の強化は未実装です。
- GitHub Actionsが通っても、専用Qwen推論エンドポイントとの本番接続・モデル識別・ストリーミング動作を実機で確認してください。
