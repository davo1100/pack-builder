"""Merge dropped HTML flow specs into one client-ready page."""
from __future__ import annotations

import html as html_lib
import re
from dataclasses import dataclass, field
from pathlib import Path

from convert import convert_document, decode_entities, is_pack_ready, undouble_amp
from icons import icon_for_title, icon_html

ROOT = Path(__file__).resolve().parent

SVG_COLORS = {
    "#1e40af": "#404C37",
    "#1d4ed8": "#404C37",
    "#1e3a8a": "#201D22",
    "#2563eb": "#FD0966",
    "#1e293b": "#201D22",
    "#0f172a": "#201D22",
    "#0284c7": "#7E6DE2",
    "#0369a1": "#7E6DE2",
    "#0891b2": "#7E6DE2",
    "#059669": "#404C37",
    "#047857": "#404C37",
    "#7c3aed": "#7E6DE2",
    "#6d28d9": "#7E6DE2",
    "#d97706": "#FD0966",
    "#e11d48": "#FD0966",
    "#f43f5e": "#FD0966",
    "#eff6ff": "#EBEAFC",
    "#bfdbfe": "#7E6DE2",
    "#dbeafe": "#EBEAFC",
    "#f0fdf4": "#F5FFD8",
    "#bbf7d0": "#93CD8F",
    "#60a5fa": "#7E6DE2",
    "#93c5fd": "#7E6DE2",
    "#cbd5e1": "#F2EEE2",
    "#94a3b8": "#857D6B",
    "#334155": "#404C37",
    "#475569": "#857D6B",
    "#64748b": "#857D6B",
}

PRE_CODE = re.compile(r"(<pre\b[^>]*>\s*<code\b[^>]*>)(.*?)(</code>\s*</pre>)", re.S | re.I)
CODE_CONTAINER_OPEN = re.compile(
    r"<div\b(?=[^>]*\bclass\s*=\s*[\"'][^\"']*\bcode-container\b)[^>]*>",
    re.I,
)
CODE_FOLD_OPEN = re.compile(
    r"<details\b(?=[^>]*\bclass\s*=\s*[\"'][^\"']*\bcode-fold\b)[^>]*>",
    re.I,
)
JSON_NUMBER = re.compile(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?")
JSON_KEYWORDS = (("true", "tok-keyword json-boolean"), ("false", "tok-keyword json-boolean"), ("null", "tok-keyword json-null"))
HTTP_METHOD_RE = re.compile(
    r"^(\s*)(URI:\s*)?(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b(\s*)(.*)$",
    re.I,
)
HTTP_HEADER_RE = re.compile(r"^(\s*)([A-Za-z][\w!#$%&'*+.^`|~-]*:)(.*)$")
CODE_LANG_ATTR = re.compile(r'\bdata-lang="([^"]+)"', re.I)
CHAPTER_HREF = re.compile(r"^(overview|flow-\d+)(?:-.*)?$")
FILENAME_NUM = re.compile(r"^(\d{1,2})(?=[._-])")


@dataclass
class Doc:
    filename: str
    title: str
    role: str
    include: bool = True
    draft: bool = False
    num: str = ""
    body: str = ""
    id: str = ""


@dataclass
class Settings:
    page_title: str = "Technical documentation | Edenred Payment Solutions"
    header_doc: str = "Technical documentation"
    logo_url: str = "https://eps.edenred.com/hubfs/EPS-Red.svg"
    logo_alt: str = "Edenred Payment Solutions"
    favicon_url: str = ""
    confidential: bool = True
    footer: str = (
        "Edenred Payment Solutions &bull; Technical documentation "
        "&bull; Confidential — for authorised clients only"
    )
    output_filename: str = "documentation.html"
    theme: dict = field(default_factory=dict)


def matching_div_end(html: str, start: int) -> int:
    return matching_tag_end(html, start, "div")


def matching_tag_end(html: str, start: int, tag: str) -> int:
    tag = tag.lower()
    if not _is_tag_open(html, start, tag):
        raise ValueError(f"start must point at <{tag}")
    token_len = len(tag) + 1
    pos = start + token_len
    depth = 1
    close_len = len(tag) + 3
    while pos < len(html) and depth:
        next_open = _find_tag_open(html, pos, tag)
        next_close = _find_close_tag(html, pos, tag)
        if next_close == -1:
            return len(html)
        if next_open != -1 and next_open < next_close:
            depth += 1
            pos = next_open + token_len
        else:
            depth -= 1
            pos = next_close + close_len
    return pos


def _is_tag_open(html: str, at: int, tag: str) -> bool:
    token = f"<{tag}"
    if at < 0 or html[at : at + len(token)].lower() != token:
        return False
    nxt = html[at + len(token)] if at + len(token) < len(html) else ""
    return nxt in " \t\r\n/>"


def _find_tag_open(html: str, pos: int, tag: str) -> int:
    token = f"<{tag}"
    lower = html.lower()
    needle = pos
    while True:
        at = lower.find(token, needle)
        if at == -1:
            return -1
        if _is_tag_open(html, at, tag):
            return at
        needle = at + 1


def _find_close_tag(html: str, pos: int, tag: str) -> int:
    return html.lower().find(f"</{tag}>", pos)


def _is_div_open(html: str, at: int) -> bool:
    return _is_tag_open(html, at, "div")


def _find_div_open(html: str, pos: int) -> int:
    return _find_tag_open(html, pos, "div")


def extract_container(html: str) -> str:
    marker = '<div class="container">'
    start = html.find(marker)
    if start == -1:
        body = re.search(r"<body[^>]*>([\s\S]*)</body>", html, re.I)
        inner = body.group(1) if body else html
        inner = re.sub(r"<nav[\s\S]*?</nav>", "", inner, count=1, flags=re.I)
        inner = re.sub(r"<script[\s\S]*?</script>", "", inner, flags=re.I)
        inner = re.sub(r"<style[\s\S]*?</style>", "", inner, flags=re.I)
        return inner.strip()
    end = matching_div_end(html, start)
    inner = html[start + len(marker) : end - 6]
    pf = inner.find('<div class="page-footer-nav">')
    if pf != -1:
        inner = inner[:pf] + inner[matching_div_end(inner, pf) :]
    inner = re.sub(r"<footer>[\s\S]*?</footer>", "", inner)
    return inner.strip()


def restyle(html: str) -> str:
    for old, new in SVG_COLORS.items():
        html = html.replace(old, new)
        html = html.replace(old.upper(), new)
    html = html.replace('font-family="sans-serif"', 'font-family="Arial, Helvetica, sans-serif"')
    html = html.replace("stroke:#2563eb", "stroke:#FD0966")
    html = html.replace('stroke="#2563eb"', 'stroke="#FD0966"')
    return html


def wrap_code_blocks(html: str) -> str:
    out = []
    i = 0
    while True:
        match = CODE_CONTAINER_OPEN.search(html, i)
        if not match:
            out.append(html[i:])
            break
        start = match.start()
        out.append(html[i:start])
        end = code_container_end(html, start)
        if end <= start:
            out.append(html[start : start + 1])
            i = start + 1
            continue
        block = html[start:end]
        if _already_in_code_fold(html, start):
            out.append(block)
            i = end
            continue
        header = re.search(r'<div class="code-header">\s*<span>(.*?)</span>', block, re.S)
        label = re.sub(r"<[^>]+>", "", header.group(1)).strip() if header else "View example"
        if not label:
            label = "View example"
        out.append(
            f'<details class="code-fold"><summary>{html_lib.escape(label)}</summary>\n{block}\n</details>'
        )
        i = end
    return "".join(out)


def code_container_end(html: str, start: int) -> int:
    end = matching_div_end(html, start)
    inner = html[start + 1 : end]
    nested = CODE_CONTAINER_OPEN.search(inner)
    if not nested:
        return end
    pre_close = html.lower().find("</pre>", start)
    nested_at = start + 1 + nested.start()
    if pre_close == -1 or pre_close > nested_at:
        return end
    close = html.lower().find("</div>", pre_close)
    return close + 6 if close != -1 else end


def _already_in_code_fold(html: str, start: int) -> bool:
    before = html[:start]
    fold = max(before.lower().rfind("class=\"code-fold\""), before.lower().rfind("class='code-fold'"))
    if fold == -1:
        return False
    return "</details>" not in before[fold:].lower()


def flatten_nested_code_folds(html: str) -> str:
    if not html:
        return html or ""
    changed = True
    while changed:
        changed = False
        for match in CODE_FOLD_OPEN.finditer(html):
            start = match.start()
            try:
                end = matching_tag_end(html, start, "details")
            except ValueError:
                continue
            inner = html[match.end() : end - len("</details>")]
            nested = _single_nested_fold(inner)
            if not nested:
                continue
            html = html[:start] + nested + html[end:]
            changed = True
            break
    return html


def _after_summary(inner: str) -> str:
    low = inner.lower()
    start = low.find("<summary")
    if start == -1:
        return inner.strip()
    close = low.find("</summary>", start)
    if close == -1:
        return inner.strip()
    return inner[close + len("</summary>") :].strip()


def _single_nested_fold(inner: str) -> str | None:
    body = _after_summary(inner)
    if not body:
        return None
    if _is_tag_open(body, 0, "div"):
        try:
            div_end = matching_tag_end(body, 0, "div")
        except ValueError:
            div_end = -1
        if div_end != -1 and not body[div_end:].strip():
            gt = body.find(">")
            body = body[gt + 1 : div_end - 6].strip()
    match = CODE_FOLD_OPEN.match(body)
    if not match:
        return None
    try:
        end = matching_tag_end(body, 0, "details")
    except ValueError:
        return None
    if body[end:].strip():
        return None
    return body[:end]


def sanitize_code_blocks(html: str) -> str:
    def repl(match: re.Match) -> str:
        opening, inner, closing = match.group(1), match.group(2), match.group(3)
        text = _code_plain(inner)
        return f"{opening}{html_lib.escape(text)}{closing}"

    return PRE_CODE.sub(repl, html or "")


def _tok(cls: str, text: str) -> str:
    return f'<span class="{cls}">{html_lib.escape(text)}</span>'


def _code_plain(inner: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", inner, flags=re.I)
    text = re.sub(r"</?(span|font)(\s[^>]*)?>", "", text, flags=re.I)
    text = re.sub(r"</div>\s*<div\b[^>]*>", "\n", text, flags=re.I)
    text = re.sub(r"</?div\b[^>]*>", "\n", text, flags=re.I)
    return html_lib.unescape(text)


def detect_code_lang(text: str, prefix: str = "", attr: str = "") -> str:
    named = (attr or "").strip().lower()
    stripped = text.lstrip()
    if stripped.startswith(("{", "[")):
        return "json"
    if HTTP_METHOD_RE.match(stripped) or stripped.upper().startswith("URI:"):
        return "http"
    if stripped.startswith("<") and ">" in stripped[:280] and not stripped.lower().startswith("<host"):
        return "xml"
    if named in {"json", "http", "xml", "text"}:
        return named
    hint = prefix.lower()
    if "json" in hint:
        return "json"
    if "http" in hint:
        return "http"
    if "xml" in hint:
        return "xml"
    return "text"


def highlight_json(src: str) -> str:
    i = 0
    n = len(src)
    out: list[str] = []
    while i < n:
        ch = src[i]
        if ch in " \t\r\n":
            j = i + 1
            while j < n and src[j] in " \t\r\n":
                j += 1
            out.append(src[i:j])
            i = j
            continue
        if ch == '"':
            j = i + 1
            while j < n:
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == '"':
                    j += 1
                    break
                j += 1
            token = src[i:j]
            k = j
            while k < n and src[k] in " \t\r\n":
                k += 1
            cls = "tok-key json-key" if k < n and src[k] == ":" else "tok-string json-string"
            out.append(_tok(cls, token))
            i = j
            continue
        if ch == "-" or ch.isdigit():
            match = JSON_NUMBER.match(src, i)
            if match and (ch != "-" or (i + 1 < n and src[i + 1].isdigit())):
                out.append(_tok("tok-number json-number", match.group(0)))
                i = match.end()
                continue
        matched_kw = False
        for word, cls in JSON_KEYWORDS:
            if src.startswith(word, i):
                end = i + len(word)
                nxt = src[end] if end < n else ""
                if not (nxt.isalnum() or nxt == "_"):
                    out.append(_tok(cls, word))
                    i = end
                    matched_kw = True
                    break
        if matched_kw:
            continue
        if ch in "{}[],:":
            out.append(_tok("tok-punct json-punct", ch))
            i += 1
            continue
        j = i + 1
        while j < n and src[j] not in ' \t\r\n{}[],:"':
            j += 1
        out.append(_tok("tok-string json-string", src[i:j]))
        i = j
    return "".join(out)


def highlight_http(src: str) -> str:
    lines = src.split("\n")
    parts: list[str] = []
    i = 0
    n = len(lines)

    def emit(html: str, index: int) -> None:
        parts.append(html)
        if index < n - 1:
            parts.append("\n")

    while i < n:
        line = lines[i]
        match = HTTP_METHOD_RE.match(line)
        if match:
            html = match.group(1)
            if match.group(2):
                html += _tok("tok-punct json-punct", match.group(2))
            html += _tok("tok-method json-boolean", match.group(3))
            html += match.group(4)
            html += _tok("tok-string json-string", match.group(5))
            emit(html, i)
            i += 1
            break
        if line.lstrip().startswith(("{", "[")):
            parts.append(highlight_json("\n".join(lines[i:])))
            return "".join(parts)
        emit(_tok("tok-string json-string", line) if line.strip() else line, i)
        i += 1

    while i < n:
        line = lines[i]
        if line.lstrip().startswith(("{", "[")):
            parts.append(highlight_json("\n".join(lines[i:])))
            return "".join(parts)
        header = HTTP_HEADER_RE.match(line)
        if header:
            emit(
                header.group(1)
                + _tok("tok-key json-key", header.group(2))
                + _tok("tok-string json-string", header.group(3)),
                i,
            )
        else:
            emit(_tok("tok-string json-string", line) if line.strip() else line, i)
        i += 1
    return "".join(parts)


def _highlight_xml_tag(tag: str) -> str:
    out: list[str] = []
    i = 0
    n = len(tag)
    while i < n:
        ch = tag[i]
        if ch in " \t\r\n":
            j = i + 1
            while j < n and tag[j] in " \t\r\n":
                j += 1
            out.append(tag[i:j])
            i = j
            continue
        if ch in "<>/?":
            out.append(_tok("tok-punct json-punct", ch))
            i += 1
            continue
        if ch in "\"'":
            quote = ch
            j = i + 1
            while j < n and tag[j] != quote:
                j += 1
            if j < n:
                j += 1
            out.append(_tok("tok-string json-string", tag[i:j]))
            i = j
            continue
        if ch == "=":
            out.append(_tok("tok-punct json-punct", ch))
            i += 1
            continue
        j = i + 1
        while j < n and tag[j] not in " \t\r\n=<>/\"'":
            j += 1
        out.append(_tok("tok-key json-key", tag[i:j]))
        i = j
    return "".join(out)


def highlight_xml(src: str) -> str:
    i = 0
    n = len(src)
    out: list[str] = []
    while i < n:
        if src.startswith("<!--", i):
            end = src.find("-->", i)
            end = n if end == -1 else end + 3
            out.append(_tok("tok-comment", src[i:end]))
            i = end
            continue
        if src[i] == "<":
            end = src.find(">", i)
            if end == -1:
                out.append(_tok("tok-key json-key", src[i:]))
                break
            out.append(_highlight_xml_tag(src[i : end + 1]))
            i = end + 1
            continue
        j = i + 1
        while j < n and src[j] != "<":
            j += 1
        out.append(html_lib.escape(src[i:j]))
        i = j
    return "".join(out)


def highlight_source(src: str, lang: str) -> str:
    if lang == "json":
        return highlight_json(src)
    if lang == "http":
        return highlight_http(src)
    if lang == "xml":
        return highlight_xml(src)
    if src.lstrip().startswith(("{", "[")):
        return highlight_json(src)
    if HTTP_METHOD_RE.match(src.lstrip()) or src.lstrip().upper().startswith("URI:"):
        return highlight_http(src)
    return html_lib.escape(src)


def highlight_code_blocks(html: str) -> str:
    def repl(match: re.Match) -> str:
        opening, inner, closing = match.group(1), match.group(2), match.group(3)
        text = _code_plain(inner)
        if not text.strip():
            return match.group(0)
        prefix = html[max(0, match.start() - 500) : match.start()]
        attr = CODE_LANG_ATTR.search(opening)
        lang = detect_code_lang(text, prefix, attr.group(1) if attr else "")
        if "data-lang=" in opening.lower():
            opening = CODE_LANG_ATTR.sub(f'data-lang="{lang}"', opening, count=1)
        else:
            opening = re.sub(r"<code\b", f'<code data-lang="{lang}"', opening, count=1, flags=re.I)
        return f"{opening}{highlight_source(text, lang)}{closing}"

    return PRE_CODE.sub(repl, html)


def is_cross_chapter(value: str) -> bool:
    return bool(CHAPTER_HREF.match(value))


def prefix_ids(html: str, prefix: str) -> str:
    original_ids = re.findall(r'(?<![\w-])id="([^"]+)"', html)

    def id_sub(m: re.Match) -> str:
        value = m.group(1)
        if value.startswith(prefix + "-") or is_cross_chapter(value):
            return m.group(0)
        return f'id="{prefix}-{value}"'

    def href_sub(m: re.Match) -> str:
        value = m.group(1)
        if value.startswith(("http", "mailto")) or is_cross_chapter(value) or value.startswith(prefix + "-"):
            return m.group(0)
        return f'href="#{prefix}-{value}"'

    html = re.sub(r'(?<![\w-])id="([^"]+)"', id_sub, html)
    html = re.sub(r'href="#([^"]+)"', href_sub, html)

    def for_sub(m: re.Match) -> str:
        value = m.group(1)
        if value.startswith(prefix + "-") or is_cross_chapter(value):
            return m.group(0)
        return f'for="{prefix}-{value}"'

    html = re.sub(r'(?<![\w-])for="([^"]+)"', for_sub, html)
    for orig in original_ids:
        if orig.startswith(prefix + "-") or is_cross_chapter(orig):
            continue
        html = html.replace(f"url(#{orig})", f"url(#{prefix}-{orig})")
    return html


def rewrite_file_links(html: str, mapping: dict[str, str]) -> str:
    for filename, target in mapping.items():
        html = html.replace(f'href="{filename}"', f'href="{target}"')
        html = html.replace(f"href='{filename}'", f'href="{target}"')
    html = html.replace("View Flow Document", "Open section")
    return html


def extract_toc_links(html: str) -> str:
    marker = '<div class="toc-card">'
    start = html.find(marker)
    if start == -1:
        return ""
    end = matching_div_end(html, start)
    block = html[start:end]
    ul = re.search(r"<ul>([\s\S]*)</ul>", block)
    return ul.group(0) if ul else ""


def sidebar_html(overview: Doc | None, chapters: list[Doc], tocs: dict[str, str]) -> str:
    parts = ['<p class="sidebar-label">Contents</p>']
    if overview:
        parts.append(
            '<div class="nav-group" data-flow="overview">'
            '<a class="nav-chapter" href="#overview"><span class="nav-num">'
            f'{html_lib.escape(overview.num or "00")}</span> '
            f"{html_lib.escape(overview.title)}</a></div>"
        )
    for flow in chapters:
        toc = tocs.get(flow.id, "")
        draft = ' <span class="nav-draft">Draft</span>' if flow.draft else ""
        parts.append(f'<div class="nav-group" data-flow="{html_lib.escape(flow.num)}">')
        parts.append(
            f'<a class="nav-chapter" href="#{flow.id}">'
            f'<span class="nav-num">{html_lib.escape(flow.num)}</span> '
            f"{html_lib.escape(flow.title)}{draft}</a>"
        )
        if toc:
            parts.append(toc.replace("<ul>", '<ul class="nav-sub">', 1))
        parts.append("</div>")
    return "\n".join(parts)


def prune_cards(html: str, allowed_hrefs: set[str]) -> str:
    marker = '<div class="card"'
    out = []
    i = 0
    href_re = re.compile(r'href="([^"]+)"')
    while True:
        start = html.find(marker, i)
        if start == -1:
            out.append(html[i:])
            break
        out.append(html[i:start])
        end = matching_div_end(html, start)
        block = html[start:end]
        hrefs = href_re.findall(block)
        drop = False
        for href in hrefs:
            if href.startswith("http"):
                continue
            if href not in allowed_hrefs:
                drop = True
                break
        if not drop:
            out.append(block)
        i = end
    return "".join(out)


def update_doc_count(html: str, count: int) -> str:
    return re.sub(
        r"(\d+)\s+Technical Flow Specifications",
        f"{count} Technical Flow Specifications",
        html,
        count=1,
    )


def chapter_nav(prev: Doc | None, nxt: Doc | None) -> str:
    left = ""
    right = ""
    if prev:
        left = (
            f'<a class="btn-link" href="#{prev.id}" style="width:auto">'
            f"← {html_lib.escape(prev.num)}. {html_lib.escape(prev.title)}</a>"
        )
    if nxt:
        right = (
            f'<a class="btn-link" href="#{nxt.id}" style="width:auto">'
            f"{html_lib.escape(nxt.num)}. {html_lib.escape(nxt.title)} →</a>"
        )
    return (
        '<div class="page-meta" style="border:0;margin-top:28px;justify-content:space-between">'
        f"{left}{right}</div>"
    )


def nav_css(chapters: list[Doc]) -> str:
    rules = []
    for flow in chapters:
        cid = flow.id
        num = flow.num
        rules.append(
            f"""body:has(#{cid}:target) .sidebar .nav-chapter[href="#{cid}"],
body:has(#{cid} :target) .sidebar .nav-chapter[href="#{cid}"] {{
  background: var(--peach);
  color: var(--plum);
  box-shadow: inset 3px 0 0 var(--eden-magenta);
}}
body:has(#{cid}:target) .nav-group[data-flow="{num}"] .nav-sub,
body:has(#{cid} :target) .nav-group[data-flow="{num}"] .nav-sub {{
  display: block;
}}"""
        )
    return "\n".join(rules)


def strip_tags(text: str) -> str:
    return decode_entities(re.sub(r"<[^>]+>", "", text or "")).strip()


def detect_role(filename: str, html: str) -> str:
    base = filename.lower()
    if re.match(r"00[_-]", base) or any(key in base for key in ("index", "hub", "overview")):
        return "overview"
    has_hero = 'class="hero"' in html
    has_grid = 'class="grid"' in html
    has_toc = 'class="toc-card"' in html
    if has_hero and has_grid and not has_toc:
        return "overview"
    return "chapter"


def detect_title(html: str, filename: str) -> str:
    match = re.search(r"<h1[^>]*>([\s\S]*?)</h1>", html)
    if match:
        title = strip_tags(match.group(1))
        if title:
            return title
    stem = re.sub(r"\.(html|docx?|pptx?|pptm|ppsx|ppsm|pps)$", "", filename, flags=re.I)
    stem = re.sub(r"^\d+[_-]?", "", stem)
    return stem.replace("_", " ").strip() or filename


def detect_num(filename: str) -> str:
    match = FILENAME_NUM.match(Path(filename).name)
    return match.group(1).zfill(2) if match else ""


def detect_draft(html: str) -> bool:
    return bool(re.search(r"badge-draft|status-draft|>Draft<", html))


CHAPTER_NAV_STYLE = "border:0;margin-top:28px;justify-content:space-between"
PACK_PLACEHOLDER = re.compile(
    r"select a page on the left|add a blank page on the left|drop html, word, or powerpoint",
    re.I,
)


def is_built_pack(html: str) -> bool:
    if not html:
        return False
    if 'class="site-header"' not in html and "class='site-header'" not in html:
        return False
    return bool(re.search(r"<section\b[^>]*\bchapter\b", html, re.I))


def _attr(html: str, name: str) -> str:
    match = re.search(rf'\b{name}="([^"]*)"', html, re.I)
    return html_lib.unescape(match.group(1)) if match else ""


def _favicon_from_html(html: str) -> str:
    for match in re.finditer(r"<link\b([^>]+)/?>", html, re.I):
        attrs = match.group(1)
        rel = {part.lower() for part in re.split(r"\s+", _attr(attrs, "rel")) if part}
        if "icon" not in rel and "shortcut" not in rel:
            continue
        href = _attr(attrs, "href")
        if href:
            return href
    return ""


def _safe_icon_url(value: str) -> str:
    text = str(value or "").strip()
    if not text or len(text) > 1_500_000:
        return ""
    lower = text.lower()
    if lower.startswith(("javascript:", "vbscript:", "data:text")):
        return ""
    if lower.startswith(("https://", "http://")):
        return text
    if lower.startswith("data:image/") and ";base64," in lower:
        return text
    return ""


def _favicon_type_attr(url: str) -> str:
    lower = str(url or "").lower()
    if "image/svg" in lower or lower.endswith(".svg"):
        return ' type="image/svg+xml"'
    if "image/png" in lower or lower.endswith(".png"):
        return ' type="image/png"'
    if "image/webp" in lower or lower.endswith(".webp"):
        return ' type="image/webp"'
    if "image/gif" in lower or lower.endswith(".gif"):
        return ' type="image/gif"'
    if "image/jpeg" in lower or lower.endswith(".jpg") or lower.endswith(".jpeg"):
        return ' type="image/jpeg"'
    if "x-icon" in lower or "vnd.microsoft.icon" in lower or lower.endswith(".ico"):
        return ' type="image/x-icon"'
    return ""


def _inner_text(html: str, pattern: str) -> str:
    match = re.search(pattern, html, re.I)
    return strip_tags(match.group(1)) if match else ""


def settings_from_pack(html: str, filename: str = "documentation.html") -> dict:
    logo_src = ""
    logo_alt = ""
    logo = re.search(
        r'<a class="brand-lockup"[^>]*>\s*<img\b([^>]+)>',
        html,
        re.I,
    )
    if logo:
        logo_src = _attr(logo.group(1), "src")
        logo_alt = _attr(logo.group(1), "alt")
    theme = {}
    root = re.search(r":root\s*\{([^}]+)\}", html)
    if root:
        block = root.group(1)
        for key, var_name in THEME_VARS.items():
            found = re.search(rf"{re.escape(var_name)}:\s*([^;]+);", block)
            if not found:
                continue
            value = _safe_theme_value(key, found.group(1).strip())
            if value:
                theme[key] = value
    return {
        "page_title": _inner_text(html, r"<title>([\s\S]*?)</title>")
        or Settings.page_title,
        "header_doc": _inner_text(html, r'<span class="header-doc">([\s\S]*?)</span>')
        or Settings.header_doc,
        "logo_url": logo_src or Settings.logo_url,
        "logo_alt": logo_alt or Settings.logo_alt,
        "favicon_url": _favicon_from_html(html),
        "confidential": bool(re.search(r'class="confidential"', html)),
        "footer": _inner_text(html, r'<p class="site-footer">([\s\S]*?)</p>')
        or Settings.footer,
        "output_filename": Path(filename).name or "documentation.html",
        "theme": theme,
    }


def _strip_chapter_nav(body: str) -> str:
    pos = body.rfind(CHAPTER_NAV_STYLE)
    if pos == -1:
        return body.strip()
    start = body.rfind("<div", 0, pos)
    if start == -1:
        return body.strip()
    return (body[:start] + body[matching_div_end(body, start) :]).strip()


def _clean_imported_body(body: str) -> str:
    body = re.sub(r"\scontenteditable(?:=([\"'][^\"']*[\"']))?", "", body, flags=re.I)
    body = re.sub(r"\sdata-layout-block(?:=([\"'][^\"']*[\"']))?", "", body, flags=re.I)
    body = re.sub(r"\sdata-protected(?:=([\"'][^\"']*[\"']))?", "", body, flags=re.I)
    body = re.sub(r"\sdata-plain(?:=([\"'][^\"']*[\"']))?", "", body, flags=re.I)
    body = re.sub(r'\sdata-lock-label="[^"]*"', "", body, flags=re.I)
    body = re.sub(r'<p class="site-footer">[\s\S]*?</p>', "", body, flags=re.I)
    return body.strip()


def _is_placeholder_overview(body: str) -> bool:
    text = re.sub(r"\s+", " ", strip_tags(body)).strip()
    return not text or bool(PACK_PLACEHOLDER.search(text))


def _pack_stem(title: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9]+", "_", title or "").strip("_")
    return (stem[:72] or "Page")


def _unique_pack_filename(num: str, title: str, used: set[str]) -> str:
    stem = _pack_stem(title)
    name = f"{num}_{stem}.html"
    extra = 2
    while name.lower() in used:
        name = f"{num}_{stem}_{extra}.html"
        extra += 1
    used.add(name.lower())
    return name


def split_built_pack(html: str, filename: str = "documentation.html") -> tuple[list[Doc], dict]:
    settings = settings_from_pack(html, filename)
    docs: list[Doc] = []
    used_names: set[str] = set()
    used_nums: set[str] = set()
    pos = 0
    while True:
        start = _find_tag_open(html, pos, "section")
        if start == -1:
            break
        gt = html.find(">", start)
        if gt == -1:
            break
        open_tag = html[start : gt + 1]
        if not re.search(r'\bclass="[^"]*\bchapter\b', open_tag, re.I):
            pos = start + 8
            continue
        end = matching_tag_end(html, start, "section")
        inner = html[gt + 1 : end - len("</section>")].strip()
        inner = _clean_imported_body(_strip_chapter_nav(inner))
        section_id = _attr(open_tag, "id")
        role = "overview" if section_id == "overview" else "chapter"
        num_match = re.fullmatch(r"flow-(\d{1,2})", section_id or "")
        num = "00" if role == "overview" else (num_match.group(1).zfill(2) if num_match else "")
        title = detect_title(inner, filename)
        if role == "overview":
            if _is_placeholder_overview(inner):
                inner = overview_hero(
                    Settings(
                        page_title=settings["page_title"],
                        header_doc=settings["header_doc"],
                    ),
                    0,
                )
            title = "Contents"
            num = "00"
            name = _unique_pack_filename(num, "Contents", used_names)
        else:
            if not title or title == Path(filename).stem.replace("_", " "):
                title = "New page"
            if not num or num in used_nums:
                seq = 1
                while f"{seq:02d}" in used_nums:
                    seq += 1
                num = f"{seq:02d}"
            name = _unique_pack_filename(num, title, used_names)
        used_nums.add(num)
        docs.append(
            Doc(
                filename=name,
                title=decode_entities(title),
                role=role,
                include=True,
                draft=detect_draft(inner),
                num=num,
                body=undouble_amp(sanitize_code_blocks(inner)),
                id=section_id or "",
            )
        )
        pos = end
    if not docs:
        raise ValueError("That pack file has no pages to edit")
    return docs, settings


def ingest_html(filename: str, raw: str, asset_dir: str | Path | None = None, images: dict | None = None) -> Doc:
    return ingest_file(filename, raw=raw, asset_dir=asset_dir, images=images)


def ingest_file(
    filename: str,
    raw: str | None = None,
    data: bytes | None = None,
    asset_dir: str | Path | None = None,
    images: dict | None = None,
) -> Doc:
    name = Path(filename).name
    from slides import is_slides_name, slides_to_html
    from word import is_word_name, word_to_html

    if is_word_name(name) or is_slides_name(name):
        if not data:
            raise ValueError("Word file is empty" if is_word_name(name) else "PowerPoint file is empty")
        html, embedded = word_to_html(data, name) if is_word_name(name) else slides_to_html(data, name)
        merged = dict(embedded)
        if images:
            merged.update(images)
        page = convert_document(html, name, asset_dir=asset_dir, images=merged)
        body = undouble_amp(sanitize_code_blocks(page["body"]))
        role = page.get("role") or detect_role(name, body)
        title = page.get("title") or detect_title(body, name)
        return Doc(
            filename=name,
            title=decode_entities(title),
            role=role,
            include=True,
            draft=detect_draft(body),
            num=detect_num(name),
            body=body,
        )
    html = raw or ""
    if is_pack_ready(html):
        body = undouble_amp(sanitize_code_blocks(extract_container(html)))
        role = detect_role(name, body or html)
        title = "Overview" if role == "overview" else detect_title(body or html, name)
    else:
        page = convert_document(html, name, asset_dir=asset_dir, images=images)
        body = undouble_amp(sanitize_code_blocks(page["body"]))
        role = page.get("role") or detect_role(name, body)
        title = page.get("title") or detect_title(body, name)
    return Doc(
        filename=name,
        title=decode_entities(title),
        role=role,
        include=True,
        draft=detect_draft(html) or detect_draft(body),
        num=detect_num(name),
        body=body,
    )


def ingest_upload(
    filename: str,
    raw: str | None = None,
    data: bytes | None = None,
    asset_dir: str | Path | None = None,
    images: dict | None = None,
) -> tuple[list[Doc], dict | None]:
    name = Path(filename).name
    from slides import is_slides_name
    from word import is_word_name

    if is_word_name(name) or is_slides_name(name):
        return [ingest_file(name, data=data, asset_dir=asset_dir, images=images)], None
    html = raw or ""
    if is_built_pack(html):
        return split_built_pack(html, name)
    return [ingest_file(name, raw=html, asset_dir=asset_dir, images=images)], None


def assign_ids(docs: list[Doc]) -> None:
    chapters = [d for d in docs if d.include and d.role != "overview"]
    overviews = [d for d in docs if d.include and d.role == "overview"]
    for overview in overviews:
        overview.id = "overview"
        overview.num = overview.num or "00"
    used = set()
    seq = 1
    for doc in chapters:
        num = (doc.num or "").strip()
        if not re.fullmatch(r"\d{1,2}", num) or num in used:
            while f"{seq:02d}" in used:
                seq += 1
            num = f"{seq:02d}"
            seq += 1
        used.add(num)
        doc.num = num
        doc.id = f"flow-{num}"
    for doc in docs:
        if not doc.include:
            doc.id = doc.id or f"flow-{doc.num or 'xx'}"


def strip_unincluded_wallet_diagram(html: str) -> str:
    html = html.replace(
        "spend controls, merchant acceptance rules, and push provisioning wallets.",
        "spend controls, and merchant acceptance rules.",
    )
    html = re.sub(
        r'<rect x="670" y="20"[\s\S]*?Google &amp; Apple Pay</text>\s*'
        r'<line x1="630" y1="110" x2="670" y2="60"[^/]*/>\s*'
        r'<line x1="630" y1="110" x2="670" y2="160"[^/]*/>',
        """<rect x="670" y="70" width="170" height="80" rx="8" fill="url(#gradControls)" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.15))"/>
          <text x="755" y="102" fill="#fff" font-size="13" font-weight="bold" text-anchor="middle" font-family="Arial, Helvetica, sans-serif">Spend Controls</text>
          <text x="755" y="124" fill="#ede9fe" font-size="10.5" text-anchor="middle" font-family="Arial, Helvetica, sans-serif">&amp; Merchant Loops</text>""",
        html,
        count=1,
    )
    return html


def included_has_wallet_pages(docs: list[Doc]) -> bool:
    hints = ("google", "apple", "push_provision", "push-provision", "push provisioning")
    for doc in docs:
        haystack = f"{doc.filename} {doc.title}".lower()
        if any(hint in haystack for hint in hints):
            return True
    return False


def _remove_divs(html: str, marker: str, should_drop) -> str:
    out = []
    i = 0
    while True:
        start = html.find(marker, i)
        if start == -1:
            out.append(html[i:])
            break
        end = matching_div_end(html, start)
        block = html[start:end]
        if should_drop(block):
            out.append(html[i:start])
        else:
            out.append(html[i:end])
        i = end
    return "".join(out)


def _drop_preceding_index_heading(prefix: str) -> str:
    return re.sub(
        r'<h2\b[^>]*>[\s\S]{0,240}?(Specification Documents|Contents|Pages)\s*</h2>\s*$',
        "",
        prefix,
        flags=re.I,
    )


def _auto_contents_spans(html: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    token = 'data-contents="auto"'
    pos = 0
    while True:
        at = html.find(token, pos)
        if at == -1:
            break
        start = html.rfind("<div", 0, at)
        if start == -1:
            pos = at + len(token)
            continue
        end = matching_div_end(html, start)
        spans.append((start, end))
        pos = end
    return spans


def strip_legacy_index(html: str) -> str:
    html = _remove_divs(
        html,
        '<div class="overview-section">',
        lambda block: "Imported from the Confluence space export" in block,
    )
    protected = _auto_contents_spans(html)
    out = []
    i = 0
    marker = '<div class="grid">'
    while True:
        start = html.find(marker, i)
        if start == -1:
            out.append(html[i:])
            break
        end = matching_div_end(html, start)
        if any(a <= start < b for a, b in protected):
            out.append(html[i:end])
            i = end
            continue
        block = html[start:end]
        hrefs = [href for href in re.findall(r'href="([^"]+)"', block) if not href.startswith(("http", "mailto"))]
        looks_like_index = (
            'class="card"' in block
            and "btn-link" in block
            and hrefs
            and all(href.startswith("#") or href.lower().endswith(".html") for href in hrefs)
        )
        if looks_like_index:
            out.append(_drop_preceding_index_heading(html[i:start]))
        else:
            out.append(html[i:end])
        i = end
    html = "".join(out)
    html = re.sub(
        r'<h2\b[^>]*>[\s\S]{0,240}?Specification Documents[\s\S]{0,80}?</h2>\s*',
        "",
        html,
        flags=re.I,
    )
    return html.strip()


def page_summary(doc: Doc) -> str:
    for paragraph in re.findall(r"<p\b[^>]*>([\s\S]*?)</p>", doc.body or ""):
        text = re.sub(r"\s+", " ", strip_tags(paragraph)).strip()
        if len(text) < 28:
            continue
        lowered = text.lower()
        if lowered.startswith(("author:", "created by", "last modified", "imported from")):
            continue
        if len(text) > 220:
            text = text[:217].rsplit(" ", 1)[0] + "…"
        return text
    headings = []
    for heading in re.findall(r"<h2\b[^>]*>([\s\S]*?)</h2>", doc.body or ""):
        label = re.sub(r"^\d+(\.\d+)*[.)]?\s*", "", re.sub(r"\s+", " ", strip_tags(heading))).strip()
        if label:
            headings.append(label)
        if len(headings) == 3:
            break
    if headings:
        return "Includes " + ", ".join(headings) + "."
    return f"Open the {doc.title} section."


def page_tags(doc: Doc) -> list[str]:
    tags: list[str] = []
    seen: set[str] = set()
    for raw in re.findall(
        r'class="api-label">API</span>\s*<span class="api-value">([\s\S]*?)</span>',
        doc.body or "",
        flags=re.I,
    ):
        text = re.sub(r"\s+", " ", strip_tags(raw)).strip()
        key = text.lower()
        if text and key not in seen:
            seen.add(key)
            tags.append(text)
        if len(tags) == 3:
            break
    return tags


def contents_card(doc: Doc) -> str:
    status = (
        '<span class="card-status status-draft">Draft</span>'
        if doc.draft
        else '<span class="card-status status-current">Current</span>'
    )
    tags = page_tags(doc)
    tag_html = (
        '<div class="card-tags">' + "".join(f'<span class="tag">{html_lib.escape(tag)}</span>' for tag in tags) + "</div>"
        if tags
        else ""
    )
    page_id = html_lib.escape(doc.filename, quote=True)
    icon_name = icon_for_title(doc.title)
    return (
        f'<div class="card" data-page-id="{page_id}" data-icon="{html_lib.escape(icon_name, quote=True)}">\n'
        "<div>\n"
        '<div class="card-header">\n'
        f'<span class="card-num">{html_lib.escape(doc.num)}</span>\n'
        f"{status}\n"
        "</div>\n"
        f"<h3>{icon_html(icon_name, 18)} {html_lib.escape(doc.title)}</h3>\n"
        f"<p>{html_lib.escape(page_summary(doc))}</p>\n"
        f"{tag_html}\n"
        "</div>\n"
        f'<a class="btn-link" href="#{html_lib.escape(doc.id, quote=True)}">'
        f"<span>Open section</span> {icon_html('arrow-right', 16)}</a>\n"
        "</div>"
    )


CONTENTS_INTRO = (
    "<p>Each section of this pack, in reading order, with a short summary and a link to open it.</p>"
)
CONTENTS_EMPTY = "<p>Include at least one chapter page to list it here.</p>"


def contents_html(chapters: list[Doc]) -> str:
    heading = f'<h2>{icon_html("list")} Contents</h2>'
    if not chapters:
        return (
            f'<div class="overview-section" data-contents="auto">\n{heading}\n'
            f"{CONTENTS_EMPTY}\n</div>"
        )
    cards = "\n".join(contents_card(doc) for doc in chapters)
    return (
        f'<div class="overview-section" data-contents="auto">\n{heading}\n{CONTENTS_INTRO}\n'
        f'<div class="grid">\n{cards}\n</div>\n</div>'
    )


def overview_hero(settings: Settings, chapter_count: int) -> str:
    title = (settings.page_title or "Documentation").split("|", 1)[0].strip() or "Documentation"
    subtitle = settings.header_doc or "Technical documentation"
    return (
        '<header class="hero">\n'
        f"<h1>{html_lib.escape(title)}</h1>\n"
        f"<p>{html_lib.escape(subtitle)}</p>\n"
        '<div class="hero-meta">\n'
        f"<span><strong>Sections:</strong> {chapter_count}</span>\n"
        "</div>\n"
        "</header>"
    )


def with_auto_contents(html: str, chapters: list[Doc]) -> str:
    return upsert_contents_section(html or "", chapters)


def _extract_cards(grid_html: str) -> dict[str, str]:
    found: dict[str, str] = {}
    marker = '<div class="card"'
    i = 0
    while True:
        start = grid_html.find(marker, i)
        if start == -1:
            break
        end = matching_div_end(grid_html, start)
        card = grid_html[start:end]
        page_id = re.search(r'data-page-id="([^"]+)"', card)
        if page_id:
            found[html_lib.unescape(page_id.group(1))] = card
        i = end
    return found


def _card_heading(card: str, title: str) -> str:
    match = re.search(r"<h3>([\s\S]*?)</h3>", card)
    icon = ""
    if match:
        found = re.search(r'<span class="pack-icon"[^>]*>[\s\S]*?</span>', match.group(1))
        if found:
            icon = found.group(0)
    if not icon:
        icon = icon_html(icon_for_title(title), 18)
    return f"<h3>{icon} {html_lib.escape(title)}</h3>"


def _refresh_card(card: str, doc: Doc) -> str:
    page_id = html_lib.escape(doc.filename, quote=True)
    if "data-page-id=" in card:
        card = re.sub(r'data-page-id="[^"]*"', f'data-page-id="{page_id}"', card, count=1)
    else:
        card = re.sub(r'<div class="card"', f'<div class="card" data-page-id="{page_id}"', card, count=1)
    card = re.sub(
        r'(<span class="card-num">)[\s\S]*?(</span>)',
        rf"\g<1>{html_lib.escape(doc.num)}\g<2>",
        card,
        count=1,
    )
    status_open = re.search(r'<span class="card-status[^"]*"[^>]*>', card)
    if not (status_open and "data-custom=" in status_open.group(0)):
        status_label = "Draft" if doc.draft else "Current"
        status_class = "status-draft" if doc.draft else "status-current"
        card = re.sub(
            r'<span class="card-status status-(?:draft|current)">[\s\S]*?</span>',
            f'<span class="card-status {status_class}">{status_label}</span>',
            card,
            count=1,
        )
    card = re.sub(r'href="#[^"]+"', f'href="#{html_lib.escape(doc.id, quote=True)}"', card, count=1)
    heading = _card_heading(card, doc.title)
    card = re.sub(r"<h3>([\s\S]*?)</h3>", lambda _m: heading, card, count=1)
    return card


def upsert_contents_section(html: str, chapters: list[Doc]) -> str:
    fresh = contents_html(chapters)
    token = 'data-contents="auto"'
    pos = (html or "").find(token)
    if pos == -1:
        cleaned = strip_legacy_index(html or "")
        if not cleaned.strip():
            return fresh
        return cleaned.rstrip() + "\n" + fresh
    div_start = html.rfind("<div", 0, pos)
    if div_start == -1:
        return html.rstrip() + "\n" + fresh
    end = matching_div_end(html, div_start)
    block = html[div_start:end]
    grid_at = block.find('<div class="grid">')
    if grid_at == -1:
        if not chapters:
            return html
        cards_html = "\n".join(contents_card(doc) for doc in chapters)
        grid = f'<div class="grid">\n{cards_html}\n</div>'
        if CONTENTS_EMPTY in block:
            replacement = grid if CONTENTS_INTRO in block else f"{CONTENTS_INTRO}\n{grid}"
            updated = block.replace(CONTENTS_EMPTY, replacement, 1)
        else:
            updated = block.rstrip() + "\n" + grid
        return html[:div_start] + updated + html[end:]
    grid_end = matching_div_end(block, grid_at)
    if not chapters:
        updated = block[:grid_at] + CONTENTS_EMPTY + block[grid_end:]
        return html[:div_start] + updated + html[end:]
    existing = _extract_cards(block[grid_at:grid_end])
    cards = []
    for doc in chapters:
        card = existing.pop(doc.filename, None)
        cards.append(_refresh_card(card, doc) if card else contents_card(doc))
    grid = '<div class="grid">\n' + "\n".join(cards) + "\n</div>"
    updated = block[:grid_at] + grid + block[grid_end:]
    return html[:div_start] + updated + html[end:]


def sync_overview(docs: list[Doc], settings: Settings | None = None) -> tuple[Doc, bool]:
    settings = settings or Settings()
    assign_ids(docs)
    included = [d for d in docs if d.include]
    overviews = [d for d in included if d.role == "overview"]
    chapters = [d for d in included if d.role != "overview"]
    created = False
    overview = overviews[0] if overviews else None
    if not overview:
        created = True
        overview = Doc(
            filename="00_Contents.html",
            title="Contents",
            role="overview",
            include=True,
            num="00",
            id="overview",
            body=overview_hero(settings, len(chapters)),
        )
    body = overview.body or overview_hero(settings, len(chapters))
    body = strip_legacy_index(body)
    overview.body = upsert_contents_section(body, chapters)
    overview.body = re.sub(
        r"(<strong>Sections:</strong> )\d+",
        rf"\g<1>{len(chapters)}",
        overview.body,
        count=1,
    )
    overview.role = "overview"
    overview.num = overview.num or "00"
    overview.include = True
    overview.id = "overview"
    return overview, created


def prepare_body(body: str, doc: Doc, mapping: dict[str, str], allowed: set[str], chapter_count: int) -> str:
    html = rewrite_file_links(body, mapping)
    if doc.role == "overview":
        html = prune_cards(html, allowed)
        html = update_doc_count(html, chapter_count)
    html = restyle(html)
    html = sanitize_code_blocks(html)
    html = wrap_code_blocks(html)
    html = flatten_nested_code_folds(html)
    html = highlight_code_blocks(html)
    html = prefix_ids(html, doc.id)
    if doc.id == "overview":
        html = html.replace('id="overview-overview"', 'id="overview-intro"')
    return html


def build_pack(docs: list[Doc], settings: Settings, css: str) -> str:
    assign_ids(docs)
    included = [d for d in docs if d.include]
    overviews = [d for d in included if d.role == "overview"]
    chapters = [d for d in included if d.role != "overview"]
    overview = overviews[0] if overviews else None
    extra_overviews = overviews[1:]
    if extra_overviews:
        for extra in extra_overviews:
            extra.role = "chapter"
            if extra.id == "overview":
                extra.id = f"flow-{extra.num or '00'}"
        chapters = extra_overviews + chapters

    mapping = {d.filename: f"#{d.id}" for d in included if d.id}
    allowed = set(mapping.values()) | {f"#{d.id}" for d in included if d.id}
    allowed.add("#overview")

    if not overview:
        overview = Doc(
            filename="_overview.html",
            title=(settings.page_title or "Overview").split("|", 1)[0].strip() or "Overview",
            role="overview",
            include=True,
            num="00",
            id="overview",
            body=overview_hero(settings, len(chapters)),
        )

    tocs: dict[str, str] = {}
    prepared_overview = ""
    if overview:
        overview_body = overview.body or overview_hero(settings, len(chapters))
        if not included_has_wallet_pages(included):
            overview_body = strip_unincluded_wallet_diagram(overview_body)
        overview_body = with_auto_contents(overview_body, chapters)
        prepared_overview = prepare_body(overview_body, overview, mapping, allowed, len(chapters))
        tocs[overview.id] = extract_toc_links(prepared_overview)

    chapter_html = []
    for i, flow in enumerate(chapters):
        body = prepare_body(flow.body, flow, mapping, allowed, len(chapters))
        tocs[flow.id] = extract_toc_links(body)
        prev = chapters[i - 1] if i else (overview or None)
        nxt = chapters[i + 1] if i + 1 < len(chapters) else None
        nav = chapter_nav(prev, nxt)
        chapter_html.append(f'<section class="chapter" id="{flow.id}">\n{body}\n{nav}\n</section>')

    sidebar = sidebar_html(overview, chapters, tocs)
    confidential = (
        '<span class="confidential">Confidential</span>' if settings.confidential else ""
    )
    extra_css = nav_css(chapters)
    themed_css = apply_theme(css, settings.theme)
    page_title = html_lib.escape(settings.page_title)
    header_doc = html_lib.escape(settings.header_doc)
    logo_url = html_lib.escape(settings.logo_url, quote=True)
    logo_alt = html_lib.escape(settings.logo_alt, quote=True)
    icon_url = _safe_icon_url(settings.favicon_url) or _safe_icon_url(settings.logo_url)
    icon_link = ""
    if icon_url:
        icon_href = html_lib.escape(icon_url, quote=True)
        icon_link = f'  <link rel="icon"{_favicon_type_attr(icon_url)} href="{icon_href}">\n'

    overview_section = ""
    if overview:
        overview_section = f"""      <section class="chapter" id="overview">
        {prepared_overview}
        <p class="site-footer">{settings.footer}</p>
      </section>"""
    elif chapters:
        overview_section = ""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{page_title}</title>
{icon_link}  <style>
{themed_css}

{extra_css}
  </style>
</head>
<body>
  <header class="site-header">
    <a class="brand-lockup" href="#overview">
      <img src="{logo_url}" alt="{logo_alt}" width="198" height="54">
    </a>
    <div class="header-meta">
      <span class="header-doc">{header_doc}</span>
      {confidential}
    </div>
  </header>

  <div class="app">
    <nav class="sidebar" aria-label="Documentation sections">
      {sidebar}
    </nav>

    <main class="content">
{overview_section}
      {"".join(chapter_html)}
    </main>
  </div>
"""
    zoom_js = load_pack_zoom_js()
    if zoom_js:
        html += "  <script>\n" + zoom_js + "\n  </script>\n"
    return html + "</body>\n</html>\n"


THEME_VARS = {
    "magenta": "--eden-magenta",
    "olive": "--olive",
    "charcoal": "--charcoal",
    "cream": "--cream",
    "violet": "--violet",
    "taupe": "--taupe",
    "white": "--white",
    "peach": "--peach",
    "plum": "--plum",
    "sidebar_width": "--sidebar-w",
    "radius": "--radius-md",
    "font_body": "--font-body",
    "content_max_width": "--content-max-width",
}

HEX_VALUE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
SIZE_VALUE = re.compile(r"^\d+(?:\.\d+)?(?:px|rem|em|%)$")
FONT_VALUE = re.compile(r"^[A-Za-z0-9 ,\"'\-]+$")


def _safe_theme_value(key: str, value: str) -> str | None:
    value = value.strip()
    if key == "font_body":
        return value if FONT_VALUE.match(value) and len(value) < 80 else None
    if key in ("sidebar_width", "radius", "content_max_width"):
        return value if SIZE_VALUE.match(value) else None
    if HEX_VALUE.match(value):
        return value
    return None


def apply_theme(css: str, theme: dict | None) -> str:
    if not theme:
        return css
    for key, var_name in THEME_VARS.items():
        raw = theme.get(key)
        if not isinstance(raw, str):
            continue
        value = _safe_theme_value(key, raw)
        if not value:
            continue
        css = re.sub(
            rf"({re.escape(var_name)}:\s*)[^;]+;",
            rf"\g<1>{value};",
            css,
            count=1,
        )
        if var_name not in css:
            css = css.replace(":root {", f":root {{\n  {var_name}: {value};", 1)
    extra = []
    width = _safe_theme_value("content_max_width", str(theme.get("content_max_width") or ""))
    if width:
        extra.append(f".content {{ max-width: {width}; }}")
    if extra:
        css = css + "\n" + "\n".join(extra)
    return css


def settings_from_payload(data: dict) -> Settings:
    raw = data.get("settings") or {}
    settings = Settings()
    for key in (
        "page_title",
        "header_doc",
        "logo_url",
        "logo_alt",
        "favicon_url",
        "footer",
        "output_filename",
    ):
        if key in raw and isinstance(raw[key], str):
            value = raw[key]
            if key == "favicon_url":
                value = _safe_icon_url(value)
            setattr(settings, key, value)
    if "confidential" in raw:
        settings.confidential = bool(raw["confidential"])
    theme = raw.get("theme")
    if isinstance(theme, dict):
        cleaned = {}
        for key, value in theme.items():
            if isinstance(key, str) and isinstance(value, str):
                safe = _safe_theme_value(key, value)
                if safe:
                    cleaned[key] = safe
        settings.theme = cleaned
    return settings


def docs_from_payload(data: dict) -> list[Doc]:
    docs = []
    for item in data.get("docs") or []:
        docs.append(
            Doc(
                filename=str(item.get("filename") or "document.html"),
                title=str(item.get("title") or "Untitled"),
                role=str(item.get("role") or "chapter"),
                include=bool(item.get("include", True)),
                draft=bool(item.get("draft", False)),
                num=str(item.get("num") or ""),
                body=str(item.get("body") or ""),
                id=str(item.get("id") or ""),
            )
        )
    return docs


def build_from_payload(data: dict, css: str | None = None) -> str:
    if css is None:
        css = (ROOT / "css" / "styles.css").read_text(encoding="utf-8")
    return build_pack(docs_from_payload(data), settings_from_payload(data), css)


def load_client_css() -> str:
    return (ROOT / "css" / "styles.css").read_text(encoding="utf-8")


def load_pack_zoom_js() -> str:
    path = ROOT / "js" / "pack-zoom.js"
    try:
        return path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return ""
