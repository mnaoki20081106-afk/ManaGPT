# ManaGPT

**使用するモデルは `huihui-ai/Huihui-Qwen3-Coder-Next-abliterated` のみです。**

モデルページ: https://huggingface.co/huihui-ai/Huihui-Qwen3-Coder-Next-abliterated

Cloudflare Workers + D1で会話履歴、ストリーミング、リサーチ、コーディングPR、自動修復を提供します。全てのテキスト推論はこのモデルIDだけを送信します。別モデルや旧プロバイダーへの自動フォールバックはありません。

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

## ローカルのPython版

```bash
python -m pip install -e '.[dev]'
export MANAGPT_PROVIDER=openai-compatible
export MANAGPT_MODEL=huihui-ai/Huihui-Qwen3-Coder-Next-abliterated
export MANAGPT_API_BASE_URL=https://YOUR-INFERENCE-ENDPOINT/v1
export MANAGPT_API_KEY=YOUR_PRIVATE_API_KEY
managpt web
```

## テスト

```bash
node --experimental-default-type=module --test tests/agent.test.mjs tests/integrations.test.mjs tests/inference.test.mjs tests/ui-wiring.test.mjs
python -m pytest -q
```

テストはモック推論とサーバーの入出力を検証します。実際のモデルのE2Eは推論エンドポイントを稼働させて検証してください。設定の詳細は [SETUP_TUTORIAL_JA.md](SETUP_TUTORIAL_JA.md) を参照してください。
