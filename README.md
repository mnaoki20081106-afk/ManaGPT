# ManaGPT

Default text model: **[cooperleong00/Qwen3-8B-Jailbroken](https://huggingface.co/cooperleong00/Qwen3-8B-Jailbroken)**.

ManaGPT has a Cloudflare Workers chat UI (sessions stored in D1), coding PR agent, public-source research and PR repair tools. The Python CLI/Web app is also maintained. All five Cloudflare text inference paths use the same dedicated endpoint config; none silently fall back to another Groq Qwen model.

**Model availability:** The exact Hugging Face repository is model weights, **not a running API**. It currently has no public Hugging Face Inference Provider. A compatible GPU-hosted vLLM (or Hugging Face dedicated Inference Endpoint) serving these exact weights is required. The pre-existing Groq API key cannot serve this model.

## Cloudflare setup

The Worker remains a lightweight client; it does not load model weights.

1. Deploy the exact model to an OpenAI-compatible HTTPS endpoint. For example, on a GPU machine with vLLM:

   ```bash
   vllm serve cooperleong00/Qwen3-8B-Jailbroken \
     --served-model-name cooperleong00/Qwen3-8B-Jailbroken \
     --api-key "$INFERENCE_TOKEN" --host 127.0.0.1 --port 8000
   ```

   Put an authenticated HTTPS reverse proxy or dedicated managed inference endpoint in front of the server. **Do not expose an unprotected inference server on the public internet.** vLLM's authentication protects /v1 routes but not every endpoint; restrict network access too. The model's BF16 weights and inference runtime require a suitable GPU.

2. Set the following on Cloudflare **Workers & Pages → managpt → Settings → Variables and Secrets**:
   - `MANAGPT_INFERENCE_BASE_URL=https://YOUR-ENDPOINT/v1` (HTTPS, ending in /v1)
   - `MANAGPT_INFERENCE_API_KEY` as a **Secret** (matching the endpoint authorization token)
   - `MANAGPT_ACCESS_TOKEN` as a **Secret** (access to the ManaGPT UI)
   - `MANAGPT_MODEL=cooperleong00/Qwen3-8B-Jailbroken` (already set in `wrangler.jsonc`)

3. The Cloudflare deployment workflow also needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in GitHub Actions Secrets. Run [Deploy Cloudflare](.github/workflows/deploy-cloudflare.yml) to deploy.

4. Optional features: `BRAVE_SEARCH_API_KEY` enables research; configure GitHub integration from the app's settings screen for coding PRs. Image inputs use a **separately configured** `MANAGPT_VISION_MODEL` and `GROQ_API_KEY`. The specified text model does not provide a guaranteed vision interface.

Without a configured dedicated endpoint, text chat/research return an explicit configuration error instead of using a different model. This is deliberate. The Worker itself is not the GPU server.

For detailed setup, including D1 and GitHub connections, see [SETUP_TUTORIAL_JA.md](SETUP_TUTORIAL_JA.md) and [cloudflare/README.md](cloudflare/README.md).

## Local Python app

Python 3.11+:

```bash
python -m pip install -e '.[dev]'
export MANAGPT_PROVIDER=openai-compatible
export MANAGPT_MODEL=cooperleong00/Qwen3-8B-Jailbroken
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
