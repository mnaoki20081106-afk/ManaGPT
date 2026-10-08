"""Conversation orchestration and OpenAI messages-compatible handoff."""
from __future__ import annotations

from datetime import datetime, timezone

from .config import Config
from .store import Store
from .ollama_api import OllamaProvider, Part
from .provider import OpenAICompatibleProvider


class Agent:
    def __init__(self, config: Config, store: Store, provider: OllamaProvider | None = None):
        self.config, self.store = config, store
        if provider is not None:
            self.provider = provider
        elif config.provider == "ollama":
            self.provider = OllamaProvider(config.ollama_host, config.num_ctx, config.temperature)
        elif config.provider in ("groq", "openrouter", "openai-compatible"):
            self.provider = OpenAICompatibleProvider(config.api_base_url, config.api_key, config.temperature)
        else:
            raise ValueError(f"Unknown inference provider: {config.provider}")

    def system_text(self, session: dict) -> str:
        return (self.config.system_prompt + "\n\n"
                + f"Role: {session['role']}\n"
                + (f"Project context:\n{session['project_context']}" if session['project_context'] else ""))

    def messages_for(self, sid: str, user_text: str) -> list[dict]:
        session = self.store.session(sid)
        # Limit is configured in individual messages, not turns.
        history = self.store.messages(sid, max(0, self.config.max_history))
        return ([{"role": "system", "content": self.system_text(session)}]
                + history + [{"role": "user", "content": user_text}])

    def stream(self, sid: str, user_text: str):
        if not user_text.strip():
            raise ValueError("Message is empty")
        session = self.store.session(sid)
        messages = self.messages_for(sid, user_text)
        answer_parts: list[str] = []
        for part in self.provider.stream(session["model"], messages, session["thinking"]):
            if part.kind == "content":
                answer_parts.append(part.text)
            yield part
        answer = "".join(answer_parts).strip()
        if not answer:
            raise RuntimeError("Model returned no answer; history was not changed")
        # An interrupted or failed stream is never written as a complete exchange.
        self.store.save_turn(sid, user_text, answer)

    def handoff(self, sid: str) -> dict:
        session = self.store.session(sid)
        return {
            "_meta": {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "source_model": session["model"],
                "format": "OpenAI chat-completions messages",
            },
            "messages": ([{"role": "system", "content": self.system_text(session)}]
                         + self.store.messages(sid)),
        }
