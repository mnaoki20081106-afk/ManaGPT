"""Local inference: load the downloaded Hugging Face weights in this Python process.

No external inference API or model downloads occur when serving a chat.
Requires GPU/CPU memory sufficient for the (roughly 80B parameter) model.
"""
from __future__ import annotations

from pathlib import Path
from queue import Empty
from threading import Lock, Thread

from .config import TARGET_MODEL
from .ollama_api import Part

DEFAULT_WEIGHTS_PATH = Path("models/huihui-qwen3-coder-next")


def check_weights(path: str | Path) -> Path:
    """Fail loudly before importing GPU libraries when weights are not installed."""
    root = Path(path).expanduser().resolve()
    if not root.is_dir() or not (root / "config.json").is_file():
        raise FileNotFoundError(
            f"Model not downloaded at {root}. Run: python scripts/download_huihui.py"
        )
    if not list(root.glob("*.safetensors")):
        raise FileNotFoundError(f"No model weight shards (*.safetensors) found in {root}")
    return root


class LocalHFProvider:
    def __init__(self, weights_path: str | Path = DEFAULT_WEIGHTS_PATH,
                 temperature: float = 0.7, max_new_tokens: int = 1024):
        self.weights_path = Path(weights_path)
        self.temperature = temperature
        self.max_new_tokens = max_new_tokens
        self._load_lock = Lock()
        self._inference_lock = Lock()
        self._model = None
        self._tokenizer = None

    def _get_model(self):
        with self._load_lock:
            if self._model is None:
                folder = check_weights(self.weights_path)
                try:
                    from transformers import AutoModelForCausalLM, AutoTokenizer
                except ImportError as exc:
                    raise RuntimeError(
                        "Install local inference requirements: pip install -e '.[local]'"
                    ) from exc
                tokenizer = AutoTokenizer.from_pretrained(str(folder), local_files_only=True)
                model = AutoModelForCausalLM.from_pretrained(
                    str(folder), dtype="auto", device_map="auto", local_files_only=True
                )
                model.eval()
                self._tokenizer, self._model = tokenizer, model
        return self._model, self._tokenizer

    def stream(self, model: str, messages: list[dict], thinking: bool):
        if model != TARGET_MODEL:
            raise ValueError("Only huihui-ai/Huihui-Qwen3-Coder-Next-abliterated can run")
        if not messages:
            raise ValueError("Messages must not be empty")
        # One generation per loaded model to avoid GPU memory contention.
        with self._inference_lock:
            loaded, tokenizer = self._get_model()
            try:
                from transformers import TextIteratorStreamer
            except ImportError as exc:
                raise RuntimeError("Install transformers to enable local inference") from exc

            inputs = tokenizer.apply_chat_template(
                messages, tokenize=True, add_generation_prompt=True, return_tensors="pt"
            )
            # A single tensor is returned by tokenizers in this mode.
            inputs = inputs.to(loaded.device)
            streamer = TextIteratorStreamer(
                tokenizer, skip_prompt=True, skip_special_tokens=True, timeout=1
            )
            errors = []
            kwargs = dict(
                input_ids=inputs, streamer=streamer,
                max_new_tokens=self.max_new_tokens,
                do_sample=self.temperature > 0,
                pad_token_id=tokenizer.eos_token_id,
            )
            if self.temperature > 0:
                kwargs["temperature"] = self.temperature

            def generate():
                try:
                    loaded.generate(**kwargs)
                except BaseException as exc:
                    errors.append(exc)

            worker = Thread(target=generate, name="managpt-local-generate", daemon=True)
            worker.start()
            iterator = iter(streamer)
            while True:
                try:
                    chunk = next(iterator)
                except StopIteration:
                    break
                except Empty:
                    if not worker.is_alive():
                        break
                    continue
                if chunk:
                    yield Part("content", chunk)
            worker.join()
            if errors:
                raise RuntimeError(f"Local model generation failed: {errors[0]}") from errors[0]
