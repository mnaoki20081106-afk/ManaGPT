# manaGPT

自分で動かす **Qwen3.8 ベースのAIチャット**。Ollama を使い、ブラウザとターミナルの両方から利用できます。

- 標準モデルは **`qwen3.8:27b`**。`qwen3:8b` 等にも変更可能
- チャットのストリーミング表示・思考モード切替
- SQLite による会話履歴の自動保存（途中で失敗した応答は保存しない）
- AIの役割とプロジェクト文脈のカスタマイズ
- OpenAI API `messages` 形式で会話をJSON書き出し（APIへの自動送信はしない）
- ローカル実行が標準。外部のAPIキーは不要

## 必要な環境

- Python 3.11以降
- [Ollama](https://ollama.com/download)（PCまたは自分で管理するサーバー）
- `qwen3.8:27b` は約18GBのモデルファイルに加え、推論用のRAM/VRAMが必要です。スペックが厳しければ小さいモデルに切り替えてください。

## セットアップ

```bash
# 1. Ollamaをインストールして起動
ollama pull qwen3.8:27b

# 2. プロジェクトをインストール
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -e .

# 3. ブラウザUIを起動
managpt web
# http://127.0.0.1:8000 にアクセス
```

ターミナル版:

```bash
managpt cli
# または python -m managpt
```

## モデルと接続先を変える

環境変数で指定します。例:

```bash
export MANAGPT_MODEL=qwen3:8b
export OLLAMA_HOST=http://127.0.0.1:11434
managpt web
```

Windows PowerShell:

```powershell
$env:MANAGPT_MODEL="qwen3:8b"
managpt web
```

Ollamaが別のマシンで動いているなら、`OLLAMA_HOST` をそのマシンのURLに設定します。**Ollamaのポートをインターネットに直接公開しないでください。** SSHトンネルやVPNで接続する構成を推奨します。

詳しい環境変数は [.env.example](.env.example) を参照してください。`.env` は自動読み込みされないので、値をシェルの環境変数として設定してください。

### 人格プロンプト

UTF-8テキストファイルを用意して `MANAGPT_SYSTEM_PROMPT_FILE=/path/to/prompt.txt` を設定すると、既定のシステムプロンプトを置き換えられます。ブラウザUIの「設定」では会話単位で役割・プロジェクト文脈・モデル・思考モードを変更できます。

### CLIコマンド

`/help`, `/think`, `/model <model>`, `/role <text>`, `/context <text>`, `/history`, `/clear`, `/save [path]`, `/load [path]`, `/export [path]`, `/exit`

`/save` で JSON セッションログを保存し、`/load` で読み込めます。`/export` は別のAIに引き継げる `messages` 配列を出力します。

## プライバシーと運用上の注意

- 会話は `MANAGPT_DB` （デフォルト `./managpt.db`）に保存されます。
- Web UIは**認証なし**のローカル向けです。既定は `127.0.0.1` のみで待ち受けます。公開サーバー運用には認証、HTTPS、アクセス制御が必要です。
- Ollama本体やモデルはこのリポジトリ・GitHub Actionsではホストされません。GitHubはコードとテストを管理します。常時チャット利用には別途実行環境が必要です。
- ブラウザはローカルストレージに現在のセッションIDを持ちます。エクスポートファイルには会話本文が入ります。

## テスト

```bash
pip install -e '.[dev]'
python -m pytest -q
```

GitHub Actionsでもpytestを実行します。テスト時にモデルのダウンロードは不要です。

## 開発の元になった機能

従来の `Qwen3-8B` CLIの会話履歴、`/think`、`/clear`、`/context`、`/role`、`/export` 機能を引き継ぎ、Qwen3.8対応・自動履歴保存・ブラウザUIを加えました。
