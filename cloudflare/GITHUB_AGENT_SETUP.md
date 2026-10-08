# GitHub開発エージェントの接続

Cloudflare版manaGPTから、GitHubリポジトリのファイルを読み取り、Qwenで修正案を作り、専用ブランチとPull Requestを作成します。PRへのpushで既存のTestsワークフローが起動します。

## 初回セットアップ（iPhoneのブラウザでも可）

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。
2. Repository accessは **Only select repositories** で開発対象リポジトリだけを指定。Repository permissionsは **Contents: Read and write** と **Pull requests: Read and write** を許可。必要最小限の有効期限にする。
3. Cloudflare Dashboard → Workers & Pages → managpt → Settings → Variables and Secrets に **GITHUB_TOKEN** を Secret として登録する。公開変数にしない。
4. 同じ画面で **GITHUB_REPOSITORY** に `owner/repository` を設定（例: `mnaoki20081106-afk/ManaGPT`）。
5. Workerをデプロイ後、manaGPTにログインして「GitHub開発エージェント」を開く。修正指示を入力し、「修正案を作成」を押す。
6. 生成されたPull Requestを開き、変更差分とChecksを確認してから手動でマージする。

**注意:** この初期版はGitHub App OAuthではなくfine-grained PATによる接続です。トークンはCloudflare Secretに保管し、チャット画面には貼らないでください。単一リポジトリ向けです。外部AIにはコードの一部が送信されます。シークレットや機密コードを含むリポジトリには使わないでください。

**動作範囲:** 一度に最大5ファイルの修正。PR作成まで自動。既存のPRテストワークフローは自動起動しますが、失敗したテストの読み取り・自動再修正・再実行はまだ未実装です。実際のGitHubトークンとGroqキーを用いたE2Eテストも未実施です。

**無料枠:** Cloudflare、Groq、GitHub Actionsの各無料枠には上限があります。
