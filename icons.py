"""Inline SVG icon library for converted pages and the pack CSS."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
_CATALOG: dict | None = None

TITLE_ICONS = (
    ("spend amount", "clock"),
    ("amount limit", "clock"),
    ("spend count", "clipboard"),
    ("count limit", "clipboard"),
    ("time restriction", "clock"),
    ("time-of-day", "clock"),
    ("date restriction", "calendar"),
    ("calendar date", "calendar"),
    ("acceptance method", "credit-card"),
    ("country code", "globe"),
    ("country", "globe"),
    ("merchant", "store"),
    ("spend", "sliders"),
    ("account holder", "user"),
    ("accountholder", "user"),
    ("organisation", "building"),
    ("organization", "building"),
    ("onboard", "user-plus"),
    ("card", "credit-card"),
    ("transaction", "receipt"),
    ("search", "search"),
    ("provision", "smartphone"),
    ("wallet", "wallet"),
    ("google", "smartphone"),
    ("apple", "smartphone"),
    ("account", "building"),
    ("api", "code"),
    ("architecture", "layers"),
    ("overview", "layers"),
    ("flow", "git-branch"),
)


def icon_catalog() -> dict:
    global _CATALOG
    if _CATALOG is None:
        _CATALOG = json.loads((ROOT / "data" / "icons.json").read_text(encoding="utf-8"))
    return _CATALOG


def icon_html(name: str, size: int = 22) -> str:
    spec = icon_catalog().get(name)
    if not spec:
        return ""
    return (
        f'<span class="pack-icon" data-icon="{name}" contenteditable="false" aria-hidden="true">'
        f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" '
        f'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        f'{spec["svg"]}</svg></span>'
    )


def icon_for_title(title: str) -> str:
    hay = (title or "").lower()
    for token, name in TITLE_ICONS:
        if token in hay:
            return name
    return "file-text"


def wrap_callout(inner: str, warning: bool = False) -> str:
    name = "warning" if warning else "info"
    cls = "callout-warning" if warning else "callout"
    return f'<div class="{cls} callout-with-icon">{icon_html(name)}<div>{inner}</div></div>'
