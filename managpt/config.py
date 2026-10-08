"""Config loaded at process startup. No secrets committed to git."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

TARGET_MODEL = "huihui-ai/Huihui-Qwen3-Coder-Next-abliterated"

DEFAULT_PROMPT = (
    "You are manaGPT, a clear, capable, direct AI assistant. "
    "Respond in the user's language. Be accurate, admit uncertainty, "
    "and ask only necessary follow-up questions. "
    "For coding tasks, provide concrete, testable solutions."
)


@dataclass(frozen=True)
class Config:
    model: str = TARGET_MODEL
    provider: str = "local"
    api_key: str = ""
    api_base_url: str = ""
    weights_path: str = "models/huihui-qwen3-coder-next"
    max_new_tokens: int = 1024
    ollama_host: str = "http://127.0.0.1:11434"
    database_path: str = "managpt.db"
    system_prompt: str = DEFAULT_PROMPT
    num_ctx: int = 8192
    temperature: float = 0.7
    max_history: int = 40

    @classmethod
    def from_env(cls) -> "Config":
        prompt = DEFAULT_PROMPT
        prompt_file = os.environ.get("MANAGPT_SYSTEM_PROMPT_FILE")
        if prompt_file:
            prompt = Path(prompt_file).read_text(encoding="utf-8")
        return cls(
            model=TARGET_MODEL,
            provider=os.getenv("MANAGPT_PROVIDER", cls.provider).lower(),
            api_key=os.getenv("MANAGPT_API_KEY", ""),
            api_base_url=os.getenv("MANAGPT_API_BASE_URL", cls.api_base_url),
            weights_path=os.getenv("MANAGPT_WEIGHTS_PATH", cls.weights_path),
            max_new_tokens=int(os.getenv("MANAGPT_MAX_NEW_TOKENS", str(cls.max_new_tokens))),
            ollama_host=os.getenv("OLLAMA_HOST", cls.ollama_host).rstrip("/"),
            database_path=os.getenv("MANAGPT_DB", cls.database_path),
            system_prompt=prompt,
            num_ctx=int(os.getenv("MANAGPT_NUM_CTX", "8192")),
            temperature=float(os.getenv("MANAGPT_TEMPERATURE", "0.7")),
            max_history=int(os.getenv("MANAGPT_MAX_HISTORY", "40")),
        )
