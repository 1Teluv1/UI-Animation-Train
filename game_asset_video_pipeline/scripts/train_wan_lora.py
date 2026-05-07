"""Thin entrypoint that wires CLI args into train.train_lora.main()."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import List, Optional

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from train.train_lora import main as train_main  # noqa: E402


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Train a Wan2.2 5B LoRA on the HTML-animation dataset.")
    p.add_argument(
        "--config",
        type=Path,
        default=PROJECT_ROOT / "train" / "lora_config.yaml",
        help="path to the YAML config (default: train/lora_config.yaml)",
    )
    p.add_argument(
        "--smoke-test",
        action="store_true",
        help="run exactly one optimizer step then exit (used to verify the pipeline)",
    )
    p.add_argument("--verbose", action="store_true")
    return p.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    cfg_path = args.config.resolve()
    if not cfg_path.exists():
        print(f"config not found: {cfg_path}", file=sys.stderr)
        return 2
    return train_main(cfg_path, smoke_test=args.smoke_test, verbose=args.verbose)


if __name__ == "__main__":
    raise SystemExit(main())
