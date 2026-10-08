# ManaGPT

**新しい対象モデルは [huihui-ai/Huihui-Qwen3-Coder-Next-abliterated](https://huggingface.co/huihui-ai/Huihui-Qwen3-Coder-Next-abliterated) です（80B、BF16）。** このモデルのHugging Face公開推論プロバイダーは提供されていないため、実際の推論には専用GPU/APIが必要です。既存のGroqとFeatherless接続は従来モデルのまま維持し、画面に実際のモデル名を表示します。

Default text model: **[cooperleong00/Qwen3-8B-Jailbroken](https://huggingface.co/cooperleong00/Qwen3-8B-Jailbroken)**.

ManaGPT has a Cloudflare Workers chat UI (sessions stored in D1), coding PR agent, public-source research and PR repair tools. The Python CLI/Web app is also maintained. All five Cloudflare text inference paths use a shared provider router. The active model is shown in the UI, including when the existing Groq model is selected.

**Model availability:** The new Huihui 80B weights have no public Hugging Face Inference Provider. A dedicated OpenAI-compatible GPU-hosted endpoint is required for the new target. Existing Featherless and Groq keys continue using the prior models.

## Cloudflare setup

The Worker remains a lightweight client; it does not load model weights.

1. **New model setup:** Deploy the exact 80B weights to a capable GPU server with a verified OpenAI-compatible HTTPS endpoint. The model's repository page includes vLLM and Ollama instructions. Existing Featherless keys do not prove this model is hosted.

   **Alternative: self-host the exact model** on an OpenAI-compatible HTTPS endpoint. For example, on a GPU machine with vLLM:

   ```bash
   vllm serve huihui-ai/Huihui-Qwen3-Coder-Next-abliterated \
     --served-model-name huihui-ai/Huihui-Qwen3-Coder-Next-abliterated \
     --api-key "$INFERENCE_TOKEN" --host 127.0.0.1 --port 8000
   ```

   Put an authenticated HTTPS reverse proxy or dedicated managed inference endpoint in front of the server. **Do not expose an unprotected inference server on the public internet.** vLLM's authentication protects /v1 routes but not every endpoint; restrict network access too. The model's BF16 weights and inference runtime require a suitable GPU.

2. If self-hosting, set the following on Cloudflare **Workers & Pages → managpt → Settings → Variables and Secrets**:
   - `MANAGPT_INFERENCE_BASE_URL=https://YOUR-ENDPOINT/v1` (HTTPS, ending in /v1)
   - `MANAGPT_INFERENCE_API_KEY` as a **Secret** (matching the endpoint authorization token)
   - `MANAGPT_ACCESS_TOKEN` as a **Secret** (access to the ManaGPT UI)
   - `MANAGPT_MODEL=huihui-ai/Huihui-Qwen3-Coder-Next-abliterated` (already set in `wrangler.jsonc`)

3. The Cloudflare deployment workflow also needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in GitHub Actions Secrets. Run [Deploy Cloudflare](.github/workflows/deploy-cloudflare.yml) to deploy.

4. Optional features: `BRAVE_SEARCH_API_KEY` enables research; configure GitHub integration from the app's settings screen for coding PRs. Image inputs use a **separately configured** `MANAGPT_VISION_MODEL` and `GROQ_API_KEY`. The specified text model does not provide a guaranteed vision interface.

**Compatibility:** Routing priority is (1) an explicitly configured OpenAI-compatible endpoint for the new Huihui 80B target, (2) existing Featherless keys with the **previous** `cooperleong00/Qwen3-8B-Jailbroken` model (override only if explicitly confirmed through `MANAGPT_FEATHERLESS_MODEL`), and (3) the existing Groq key with `qwen/qwen3.8-27b`. The UI shows the model actually in use and marks non-target models as fallback. Only an endpoint that hosts Huihui can run the new weights.

For detailed setup, including D1 and GitHub connections, see [SETUP_TUTORIAL_JA.md](SETUP_TUTORIAL_JA.md) and [cloudflare/README.md](cloudflare/README.md).

## Local Python app

Python 3.11+:

```bash
python -m pip install -e '.[dev]'
export MANAGPT_PROVIDER=openai-compatible
export MANAGPT_MODEL=huihui-ai/Huihui-Qwen3-Coder-Next-abliterated
export MANAGPT_API_BASE_URL=https://YOUR-ENDPOINT/v1
export MANAGPT_API_KEY=YOUR_ENDPOINT_TOKEN
managpt web
```

Open `http://127.0.0.1:8000` or use `managpt cli`. Python app history is stored locally in SQLite; Cloudflare chat history uses D1. Ollama remains available by explicitly selecting `MANAGPT_PROVIDER=ollama` and installing the model you want to use.

## Verification

```bash
node --experimental-default-type=module --test tests/agent.test.mjs tests/integrations.test.mjs tests/inference.test.mjs tests/ui-wiring.test.mjs
python -m pytest -q
```

These are offline tests using mocked inference responses. An **end-to-end test with the actual model** additionally requires a deployed endpoint and credentials. Never commit API keys, model server credentials or exported conversation logs to Git.
