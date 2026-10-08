"""Offline tests of the direct model runtime; do not download 160GB in CI."""
from __future__ import annotations

import queue
import sys
import types

import pytest

from managpt.config import Config, TARGET_MODEL
from managpt.local_model import LocalHFProvider, check_weights


def test_local_provider_is_the_default(monkeypatch):
    monkeypatch.delenv("MANAGPT_PROVIDER", raising=False)
    monkeypatch.delenv("MANAGPT_WEIGHTS_PATH", raising=False)
    cfg = Config.from_env()
    assert cfg.provider == "local"
    assert cfg.model == TARGET_MODEL
    assert cfg.weights_path == "models/huihui-qwen3-coder-next"


def test_weights_missing_does_not_attempt_remote_download(tmp_path):
    with pytest.raises(FileNotFoundError, match="python scripts/download_huihui.py"):
        check_weights(tmp_path / "missing")
    directory = tmp_path / "partial"
    directory.mkdir()
    (directory / "config.json").write_text("{}", encoding="utf-8")
    with pytest.raises(FileNotFoundError, match="safetensors"):
        check_weights(directory)


class _FakeTensor:
    def to(self, device):
        return self


class _FakeTokenizer:
    eos_token_id = 0

    def apply_chat_template(self, messages, **options):
        assert options["add_generation_prompt"] is True
        assert messages[-1]["content"] == "こんにちは"
        return _FakeTensor()


class _FakeStreamer:
    def __init__(self, tokenizer, **options):
        self.q = queue.Queue()
        self.timeout = options["timeout"]

    def __iter__(self):
        return self

    def __next__(self):
        part = self.q.get(timeout=self.timeout)
        if part is None:
            raise StopIteration
        return part


class _FakeModel:
    device = "cpu"

    def __init__(self, should_fail=False):
        self.should_fail = should_fail
        self.calls = []

    def generate(self, **options):
        self.calls.append(options)
        if self.should_fail:
            raise RuntimeError("fake GPU failure")
        for value in ("こんにちは", "、世界"):
            options["streamer"].q.put(value)
        options["streamer"].q.put(None)


def test_direct_in_process_generation_no_network(monkeypatch):
    monkeypatch.setitem(sys.modules, "transformers", types.SimpleNamespace(TextIteratorStreamer=_FakeStreamer))
    local = LocalHFProvider(temperature=0.5, max_new_tokens=128)
    fake_model = _FakeModel()
    local._get_model = lambda: (fake_model, _FakeTokenizer())
    stream = list(local.stream(TARGET_MODEL, [{"role": "user", "content": "こんにちは"}], False))
    assert "".join(part.text for part in stream) == "こんにちは、世界"
    assert all(part.kind == "content" for part in stream)
    assert fake_model.calls[0]["max_new_tokens"] == 128
    assert fake_model.calls[0]["temperature"] == 0.5
    with pytest.raises(ValueError, match="Only"):
        list(local.stream("legacy-model", [{"role": "user", "content": "こんにちは"}], False))


def test_generator_failure_is_propagated_and_does_not_hang(monkeypatch):
    monkeypatch.setitem(sys.modules, "transformers", types.SimpleNamespace(TextIteratorStreamer=_FakeStreamer))
    local = LocalHFProvider()
    local._get_model = lambda: (_FakeModel(should_fail=True), _FakeTokenizer())
    with pytest.raises(RuntimeError, match="fake GPU failure"):
        list(local.stream(TARGET_MODEL, [{"role": "user", "content": "こんにちは"}], False))
