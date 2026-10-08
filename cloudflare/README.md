# manaGPT：iPhoneだけでも進められる初回セットアップ

**目的：** PC・有料GPU・ターミナル不要。Cloudflare Workers + D1 + Groq を使い、Safariからいつでもアクセスできる個人用AIを作ります。

## 最短ルート：アカウント作成と4つのシークレット設定

1. [Cloudflare](https://dash.cloudflare.com/sign-up) と [Groq](https://console.groq.com/) に無料登録。Groqの [API Keys](https://console.groq.com/keys) からAPIキーを発行。
2. Cloudflareの [API Tokens](https://dash.cloudflare.com/profile/api-tokens) で **Edit Cloudflare Workers** テンプレートからトークンを発行。対象アカウントを絞る。CloudflareダッシュボードのAccount IDも控える。
3. GitHubの [manaGPT Actions secrets](https://github.com/mnaoki20081106-afk/ManaGPT/settings/secrets/actions) に **CLOUDFLARE_API_TOKEN** と **CLOUDFLARE_ACCOUNT_ID** を追加する。秘密値はチャットやリポジトリのファイルには貼らない。
4. [Deploy Cloudflare](https://github.com/mnaoki20081106-afk/ManaGPT/actions/workflows/deploy-cloudflare.yml) を開き、**Run workflow** → **Run workflow**。完了したらCloudflareのWorkers & Pagesで `managpt` を開く。D1はWranglerが初回デプロイ時に自動作成する（Cloudflare側で確認可能）。
5. Cloudflare Workersの `managpt` → Settings → Variables and Secrets に、**GROQ_API_KEY** (GroqのAPIキー) と **MANAGPT_ACCESS_TOKEN** (自分で作った長いランダムなパスワード) を **Secret** として追加してデプロイ。2つとも公開変数ではなくSecretにする。
6. Workersの **workers.dev** URLをSafariで開き、MANAGPT_ACCESS_TOKENを入力して接続。会話できれば完成。Safariの共有メニュー → **ホーム画面に追加**。

**2回目以降：** mainブランチのCloudflare関連コードを変更するとGitHub Actionsが自動デプロイします。パスワードやAPIキーを変更したいときはCloudflareダッシュボードでSecretを更新します。

## 失敗したとき
- GitHub Actionsが失敗: GitHubのSecrets名・Cloudflare APIトークンの権限とAccount IDを確認。
- `503`: Cloudflareに2つのSecretがあるか確認。
- `401`: MANAGPT_ACCESS_TOKENを再入力。
- `502`: Groq APIキー、無料枠、モデル名を確認。無料枠の上限では生成できません。
- `500`: D1バインディングの作成状況とWorkersログを確認。

## セキュリティと料金
- 無料枠は無制限ではありません。無料枠内ならサーバー費用は0円です。
- workers.dev URLは公開URLです。トークン認証が必要なAPIでも、チャット画面自体は公開されます。
- この実装は個人用の簡易認証で、Cloudflare Access等の強化は未実装です。
- GitHub Actionsが通っても、Groqとの本番接続にはAPIキーを使った実機確認が必要です。
