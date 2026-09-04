"""Build a shareable zip of the pack builder, without confidential source pages."""
from __future__ import annotations

import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
KIT_NAME = "pack-builder"
KIT = DIST / KIT_NAME
ZIP_PATH = DIST / f"{KIT_NAME}.zip"

FILES = (
    "studio.py",
    "studio.html",
    "convert.py",
    "merge.py",
    "word.py",
    "icons.py",
    "build_site.py",
    "Start Pack Builder.bat",
    "README.md",
)
DIRS = ("css", "js", "data", "assets")
EMPTY_DIRS = ("inbox", "source")


def copy_tree(src: Path, dest: Path) -> None:
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(src, dest, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))


def build() -> Path:
    if DIST.exists():
        shutil.rmtree(DIST)
    KIT.mkdir(parents=True)

    for name in FILES:
        src = ROOT / name
        if not src.is_file():
            raise SystemExit(f"Missing {name}")
        shutil.copy2(src, KIT / name)

    for name in DIRS:
        src = ROOT / name
        if not src.is_dir():
            raise SystemExit(f"Missing {name}/")
        copy_tree(src, KIT / name)

    for name in EMPTY_DIRS:
        (KIT / name).mkdir()
        (KIT / name / ".keep").write_text("", encoding="utf-8")

    if ZIP_PATH.exists():
        ZIP_PATH.unlink()
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in KIT.rglob("*"):
            if path.is_file():
                zf.write(path, Path(KIT_NAME) / path.relative_to(KIT))

    print(f"Wrote {ZIP_PATH} ({ZIP_PATH.stat().st_size:,} bytes)")
    return ZIP_PATH


if __name__ == "__main__":
    build()
