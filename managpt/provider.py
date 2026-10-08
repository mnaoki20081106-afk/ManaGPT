"""OpenAI-compatible streaming inference provider."""
import json
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from .ollama_api import Part, OllamaError

class OpenAICompatibleProvider:
    def __init__(self, base_url, api_key, temperature=0.7):
        if not base_url.startswith("https://"):
            raise ValueError("External inference endpoint must use HTTPS")
        if not api_key:
            raise ValueError("MANAGPT_API_KEY is required")
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.api_key = api_key
        self.temperature = temperature

    def stream(self, model, messages, thinking):
        payload = json.dumps({"model": model, "messages": messages, "stream": True,
                              "temperature": self.temperature}).encode()
        req = Request(self.url, data=payload, headers={
            "Authorization": "Bearer " + self.api_key,
            "Content-Type": "application/json", "Accept": "text/event-stream"})
        try:
            with urlopen(req, timeout=180) as response:
                completed = False
                for raw in response:
                    line = raw.decode("utf-8").strip()
                    if not line.startswith("data: "):
                        continue
                    item = line[6:]
                    if item == "[DONE]":
                        completed = True
                        break
                    event = json.loads(item)
                    if event.get("error"):
                        raise OllamaError(str(event["error"]))
                    for choice in event.get("choices", []):
                        delta = choice.get("delta") or {}
                        if delta.get("reasoning_content") and thinking:
                            yield Part("thinking", delta["reasoning_content"])
                        if delta.get("content"):
                            yield Part("content", delta["content"])
                        if choice.get("finish_reason"):
                            completed = True
                if not completed:
                    raise OllamaError("Incomplete provider stream")
        except HTTPError as e:
            raise OllamaError(f"Inference HTTP {e.code}: {e.read(512).decode(errors='replace')}") from e
        except URLError as e:
            raise OllamaError(f"Inference connection failed: {e.reason}") from e
