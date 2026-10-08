"""Dependency-free Ollama /api/chat streaming adapter."""
from __future__ import annotations

import json
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class Part:
    kind: str  # content or thinking
    text: str


class OllamaError(RuntimeError):
    pass


class OllamaProvider:
    def __init__(self, host: str, num_ctx: int = 8192, temperature: float = 0.7):
        if not host.startswith(("http://", "https://")):
            raise ValueError("OLLAMA_HOST must be an http(s) URL")
        self.url = host.rstrip("/") + "/api/chat"
        self.num_ctx = num_ctx
        self.temperature = temperature

    def stream(self, model: str, messages: list[dict], thinking: bool):
        payload = json.dumps({
            "model": model,
            "messages": messages,
            "stream": True,
            "think": thinking,
            "options": {"num_ctx": self.num_ctx, "temperature": self.temperature},
        }).encode("utf-8")
        req = Request(self.url, data=payload, headers={"Content-Type": "application/json"})
        try:
            with urlopen(req, timeout=300) as resp:
                completed = False
                for line in resp:
                    if not line.strip():
                        continue
                    try:
                        data = json.loads(line)
                    except (ValueError, UnicodeDecodeError) as e:
                        raise OllamaError("Malformed Ollama stream") from e
                    if data.get("error"):
                        raise OllamaError(str(data["error"]))
                    message = data.get("message") or {}
                    for key in ("thinking", "content"):
                        if message.get(key):
                            yield Part("thinking" if key == "thinking" else "content", message[key])
                    if data.get("done"):
                        completed = True
                        break
                if not completed:
                    raise OllamaError("Ollama stream ended before completion")
        except HTTPError as e:
            body = e.read(2048).decode("utf-8", errors="replace")
            raise OllamaError(f"Ollama HTTP {e.code}: {body}") from e
        except URLError as e:
            raise OllamaError(f"Ollama connection failed ({self.url}): {e.reason}") from e
