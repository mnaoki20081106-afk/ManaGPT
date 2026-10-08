# GitHub開発エージェントの接続

Cloudflare版manaGPTから、GitHubリポジトリのファイルを読み取り、設定されたコーディングモデルで修正案を作り、専用ブランチとPull Requestを作成します。PRへのpushで既存のTestsワークフローが起動します。

## 初回セットアップ（iPhoneのブラウザでも可）

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。
2. Repository accessは **Only select repositories** で開発対象リポジトリだけを指定。Repository permissionsは **Contents: Read and write**、**Pull requests: Read and write**、**Actions: Read-only**、**Checks: Read-only**、**Commit statuses: Read-only**、**Issues: Read and write** を許可。必要最小限の有効期限にする。
3. Cloudflare Dashboard → Workers & Pages → managpt → Settings → Variables and Secrets に **GITHUB_TOKEN** を Secret として登録する。公開変数にしない。
4. 同じ画面で **GITHUB_REPOSITORY** に `owner/repository` を設定（例: `mnaoki20081106-afk/ManaGPT`）。
5. Workerをデプロイ後、manaGPTにログインして「GitHub開発エージェント」を開く。修正指示を入力し、「修正案を作成」を押す。
6. 生成されたPull Requestを開き、変更差分とChecksを確認してから手動でマージする。

**注意:** この初期版はGitHub App OAuthではなくfine-grained PATによる接続です。トークンはCloudflare Secretに保管し、チャット画面には貼らないでください。単一リポジトリ向けです。外部AIにはコードの一部が送信されます。シークレットや機密コードを含むリポジトリには使わないでください。

**動作範囲:** 一度に最大12ファイルの修正。PR作成後、Cloudflare Cron（15分間隔）でテストを監視し、失敗したチェックの注釈とGitHub Actionsログを参照して最大3回まで修正を試みます。CIの成功を保証するものではありません。PRのマージは手動です。GitHubトークンとGroqキーを用いた本番E2Eテストは未実施です。

**無料枠:** Cloudflare、Groq、GitHub Actionsの各無料枠には上限があります。

## コーディングエージェント強化版

現在は一回の生成ではなく、ファイルの追加読み取り・文字列検索・修正案・別呼び出しによるレビュー・指摘の修正を繰り返します。変更は一つのコミットとして公開し、Draft PRを作成します。レビュー承認はテスト成功を意味しません。実行結果は既存のGitHub Actionsから取得します。

- コードはベースコミットのSHAで固定して全文を読みます。途中で切ったファイルを上書きしません。
- `AGENTS.md` と編集対象の親ディレクトリの指示を読みます。
- 既存ファイルは読み取り済みのものだけ編集できます。新しいソース・回帰テストも追加できます。
- 最大8回の調査／修正ラウンド、40ファイル、1ファイル80,000文字、読込合計160,000文字、12ファイルの編集に対応します。レビュー呼び出しは各修正案につき最大2回（実装レビューとテスト監査）です。
- 検索の本文対象は読込済みファイルです。パス検索は読込可能な全マニフェストが対象です。関連ファイルを追加で読んで調査範囲を広げます。
- CI修復でも同じループを使い、PRの変更外の関連ファイルを調査・修正できます。修復中にPRの先端が変更された場合は更新を中止します。
- 不正なJSON、未読ファイルへの上書き、予算超過、レビュー不合格ではPRを作りません。GitHubへの一括公開後にPR作成が失敗した場合は、復旧用のブランチ名とコミットを返します。
- `validation` は `pending_ci`（新規PR）、`pending`、`passed`、`not_passed`、`unknown` を返します。チェック未登録・一覧不完全を成功扱いしません。`passed` は設定した必須チェックがすべて存在し、取得したCheck Runsと旧形式Commit Statusesがすべて成功した場合だけです。要件全体の正しさの保証ではありません。

### コーディング用モデルの設定

通常チャットの設定を維持したまま、次をWorkerのVariables/Secretsへ設定できます。

|設定|種類|用途|
|---|---|---|
|`AGENT_API_BASE_URL`|Variable|Chat Completions互換のHTTPSベースURL。省略時は既存Groq設定|
|`AGENT_API_KEY`|Secret|そのプロバイダーのキー。省略時は`GROQ_API_KEY`|
|`AGENT_MODEL`|Variable|コーディング用モデルID。省略時は`MANAGPT_MODEL`|
|`AGENT_REVIEW_MODEL`|Variable|同じプロバイダーのレビュー用モデルID。省略時はコーディング用モデル|

モデルIDは利用中プロバイダーで実際に利用可能なものを指定してください。既存チャットのための`GROQ_API_KEY`、認証用`MANAGPT_ACCESS_TOKEN`、DB設定は引き続き必要です。生成・レビュー回数に応じて推論の消費量と待ち時間は増えます。

### 再利用できる依頼文

```text
目的：［ユーザーから見た必要な動作］
現状：［不具合と再現手順・入力・実際の出力］
期待：［期待する出力と境界条件］
制約：［維持すべきAPI・データ・既存機能］
関連ファイルを読み、原因を特定し、回帰テストを含めて修正してください。
レビューの指摘を解消し、実行予定のテストコマンドをPRへ記録してください。
未実行のテストを成功扱いしないでください。
```

### 検証の意味

`node --test tests/agent.test.mjs` はGitHubとモデルの応答を差し替えたプロトコル回帰テストです。追加読込、レビュー指摘の解消、原子的コミット、新規テスト追加、全文読込、競合検出を検証します。実モデルの問題解決能力や本番接続は別の評価です。同じバグ修正課題を同じ制限時間・テストで解かせ、成功率・回帰・費用を比較してモデルを選定してください。この改修だけで別のコーディングエージェントと同等の能力が実証されたことにはなりません。


## 正確性を優先する検証（追加）

1. プログラムの変更案には、変更・追加された回帰テストファイルが必要です。不足すると生成ループへ戻ります。ファイル名による判定のため、独自のテスト配置では一般的な `tests/`、`test_*.py`、`*.test.js`、`*_test.go` などへ置いてください。テストの意味的な有効性は次の監査とCIで確認します。
2. 実装レビューでは要件、呼び出し元、例外、状態、互換性を確認します。別の呼び出しによるテスト監査では境界値、失敗条件、弱めたアサーション、動作を隠すモック、元の不具合を再現しないテストを点検します。両方が同じ最終案を承認するまで公開しません。片方の指摘で変更した場合は両方を再実行します。同じモデルを使うと誤りが相関する可能性は残ります。
3. JSONファイルの構文、空のファイル、NUL、未読の指示ファイルはモデルの自己申告に依存せず検査します。
4. `AGENT_REQUIRED_CHECKS` をJSON配列の文字列で設定してください。このリポジトリの `wrangler.jsonc` には `["javascript","pytest"]` を設定しました。対象リポジトリを変えたら実際の必須ジョブ名へ変更してください。未設定・欠落時は `unknown` です。外部CIも必須名に追加できます。
5. CIのCheck RunsとCommit Statusesを、同じコミットSHAでそれぞれ最大500件まで取得します。スキップ・中止・中立は成功に含めません。ページ不整合・取得上限超過は `unknown` にします。判定後にPR先端を再確認します。
6. Cron修復はCI結果を共通の判定処理で確認します。一時的な通信エラーを処理済みにせず次回再試行します。PR公開後のテストは既存GitHub Actionsで実行し、ドラフトの自動マージは行いません。

API仕様: https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference および https://docs.github.com/en/rest/commits/statuses#get-the-combined-status-for-a-specific-reference
