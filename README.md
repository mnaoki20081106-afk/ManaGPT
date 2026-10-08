# ManaGPT

**使用するモデルは `huihui-ai/Huihui-Qwen3-Coder-Next-abliterated` のみです。**

モデルページ: https://huggingface.co/huihui-ai/Huihui-Qwen3-Coder-Next-abliterated

Cloudflare Workers + D1で会話履歴、ストリーミング、リサーチ、コーディングPR、自動修復を提供します。全てのテキスト推論はこのモデルIDだけを送信します。別モデルや旧プロバイダーへの自動フォールバックはありません。

## モデル本体をダウンロードしてローカル実行（推奨）

この方法は**外部の推論APIを使いません**。PythonのManaGPTが、同じPC/GPUサーバーのストレージにあるHugging Faceのモデル重みを**直接読み込みます**。

**必要なもの：** Python 3.11以上、十分なSSD空き容量とGPU/CPU RAM。80B BF16の重みは概算160GBで、実行時には重み以外のメモリも必要です。大量のメモリがないPCや、iPhone、Cloudflare Workers単体では稼働できません。モデルをロードする端末の環境に応じてPyTorchを導入してください。

```bash
# モデルを実行するPC/サーバーで、GitHubからリポジトリを取得
git clone https://github.com/mnaoki20081106-afk/ManaGPT.git
cd ManaGPT

# CUDA環境に合うPyTorchをインストール後、必要なPythonパッケージを準備
python -m pip install -e '.[local]'

# HFモデルのファイルをmodels/以下にダウンロード（大容量）
python scripts/download_huihui.py

# PythonのManaGPTから、保存済みの重みを直接読み込んで会話
MANAGPT_PROVIDER=local managpt web
```

ブラウザーで `http://127.0.0.1:8000` を開きます。Windows PowerShellでは最後の行を `$env:MANAGPT_PROVIDER="local"; managpt web` に置き換えます。CLIなら `managpt cli` です。

- 重みは `models/huihui-qwen3-coder-next/` に保存され、Gitで管理・アップロードしません（`.gitignore`に登録）。ダウンロードが途中で止まった場合は同じコマンドを再実行してください。
- 実行時は `local_files_only=True` で読み込み、外部の推論APIを呼びません。`MANAGPT_WEIGHTS_PATH` で保存場所を変更可能です。
- 重み自体をGitHubリポジトリやCloudflare Workerへアップロードする設計ではありません。Cloudflare版のUIから同じモデルを使うには、GPUがある端末を別途ネットワーク経由で接続する必要があります。
- 低スペック端末で使うには量子化済みの同系統モデルなど別途検討が必要です。この実装は指定されたHugging Faceの元の重み専用です。
- 初回のモデルロードには時間がかかります。GPU要件は実際の機種・精度・コンテキスト長によって変わります。

## Cloudflareで利用する

Hugging Faceのモデルリポジトリには80Bの重みが公開されていますが、公開のInference Providerはありません。Cloudflare WorkerはGPU推論を実行しないため、このモデルを動かすOpenAI互換の推論サーバーを別途準備してください。

Cloudflare Dashboard → Workers & Pages → managpt → Settings → Variables and Secrets:

```text
MANAGPT_INFERENCE_BASE_URL=https://YOUR-INFERENCE-ENDPOINT/v1
MANAGPT_INFERENCE_API_KEY=(認証用Secret)
MANAGPT_MODEL=huihui-ai/Huihui-Qwen3-Coder-Next-abliterated
```

`MANAGPT_MODEL`は`wrangler.jsonc`に設定済みです。認証キーは必ずSecretに設定してください。推論サーバーはこの正確なモデルIDでのChat Completionsを受け付けるよう構成します。GPUを自分で運用する場合はモデルカード記載のvLLM/SGLang/Ollamaを参照してください。

`GROQ_API_KEY`、`FEATHERLESS_API_KEY`、`MANAGPT_VISION_MODEL`はテキスト推論に使用しません。画像入力も未対応です。推論先未設定なら503を返し、別モデルへ切り替わりません。既存のD1、GitHub連携、チャット履歴は維持されます。

## テスト

```bash
node --experimental-default-type=module --test tests/agent.test.mjs tests/integrations.test.mjs tests/inference.test.mjs tests/ui-wiring.test.mjs
python -m pytest -q
```

テストはモック推論とサーバーの入出力を検証します。実際のモデル重みを読み込むE2Eは、十分なGPU/メモリを持つ実行環境で検証してください。設定の詳細は [SETUP_TUTORIAL_JA.md](SETUP_TUTORIAL_JA.md) を参照してください。
