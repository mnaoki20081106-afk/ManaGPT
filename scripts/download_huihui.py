"""Download the exact Huihui model weights into an ignored local directory.

Run on the machine that will perform inference, not in Cloudflare Workers.
Requires disk space for the BF16 80B parameter checkpoint (~160 GB).
"""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

MODEL_ID = "huihui-ai/Huihui-Qwen3-Coder-Next-abliterated"
DEFAULT_DEST = Path("models/huihui-qwen3-coder-next")
IGNORE = ["*.md", "*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp", "*.mp4"]


def download(destination: Path = DEFAULT_DEST, revision: str | None = None) -> Path:
    try:
        from huggingface_hub import HfApi, snapshot_download
    except ImportError as exc:
        raise RuntimeError(
            "Install downloader dependencies: pip install -e '.[local]'"
        ) from exc

    destination = destination.expanduser().resolve()
    destination.mkdir(parents=True, exist_ok=True)
    info = HfApi().model_info(MODEL_ID, revision=revision, files_metadata=True)
    sizes = [
        entry.size for entry in info.siblings
        if entry.rfilename.endswith(".safetensors") and entry.size is not None
    ]
    if sizes:
        needed = sum(sizes)
        free = shutil.disk_usage(destination).free
        # Small margin for snapshot metadata, tokenizer, download state.
        if free < needed * 1.05:
            raise OSError(
                f"Not enough disk space. Need at least {needed * 1.05 / 10**9:.1f} GB "
                f"free; found {free / 10**9:.1f} GB."
            )

    print(f"Downloading {MODEL_ID} at revision {info.sha} into {destination}")
    snapshot_download(
        repo_id=MODEL_ID, revision=info.sha, local_dir=str(destination),
        ignore_patterns=IGNORE, max_workers=4,
    )
    from managpt.local_model import check_weights
    check_weights(destination)
    (destination / ".source-revision").write_text(info.sha + "\n", encoding="utf-8")
    print(f"Download complete; weights verified at {destination}")
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description="Download ManaGPT's local Huihui weights")
    parser.add_argument("--destination", type=Path, default=DEFAULT_DEST)
    parser.add_argument("--revision", default=None, help="Optional HF commit SHA/tag")
    args = parser.parse_args()
    download(args.destination, args.revision)


if __name__ == "__main__":
    main()
