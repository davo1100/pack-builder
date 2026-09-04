"""CLI: build a client pack from source/ (skips Google/Apple flow files)."""
from __future__ import annotations

from pathlib import Path

from merge import ROOT, Settings, build_pack, ingest_html, load_client_css

SKIP_PREFIXES = ("07_", "08_")


def load_source_docs() -> list:
    source_dir = ROOT / "source"
    files = sorted(source_dir.glob("*.html"))
    docs = []
    for path in files:
        if path.name.startswith(SKIP_PREFIXES):
            continue
        docs.append(ingest_html(path.name, path.read_text(encoding="utf-8")))
    return docs


def build() -> None:
    docs = load_source_docs()
    if not docs:
        raise SystemExit("No HTML files found in source/")
    settings = Settings(
        page_title="DARWIN VCN Usage Flows | Edenred Payment Solutions",
        header_doc="DARWIN VCN · Technical documentation",
        output_filename="index.html",
        footer=(
            "Edenred Payment Solutions &bull; DARWIN Virtual Card Number documentation "
            "&bull; Confidential — for authorised clients only"
        ),
    )
    html = build_pack(docs, settings, load_client_css())
    (ROOT / "index.html").write_text(html, encoding="utf-8")
    print(f"Wrote index.html ({len(html):,} chars)")


if __name__ == "__main__":
    build()
