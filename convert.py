"""Turn raw HTML (Confluence export or generic) into the client pack page template."""
from __future__ import annotations

import base64
import html as html_lib
import json
import re
from html.parser import HTMLParser
from pathlib import Path

from icons import icon_for_title, icon_html, wrap_callout

VOID = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
}
SKIP_TAGS = {"style", "script"}
INLINE_TAGS = {"a", "abbr", "b", "br", "code", "em", "i", "img", "span", "strong", "sub", "sup", "time", "u"}
API_LABELS = ("api", "endpoint", "link", "reference", "request", "method")
LABEL_NAMES = {
    "api": "API",
    "endpoint": "Endpoint",
    "link": "Reference",
    "reference": "Reference",
    "request": "Request",
    "method": "Method",
}
API_LABEL_RE = re.compile(
    r"^(API|Endpoint|Link|Reference|Request|Method)\s*:\s*",
    re.I,
)
HTTP_RE = re.compile(r"^\s*(GET|POST|PUT|PATCH|DELETE|HEAD)\s+(\S+)", re.I)
HEADING_NUM_RE = re.compile(r"^(\d+(?:\.\d+)*)[.)]?\s+")
METHOD_BADGE = {
    "GET": "badge-get",
    "POST": "badge-post",
    "PUT": "badge-put",
    "PATCH": "badge-patch",
    "DELETE": "badge-put",
    "HEAD": "badge-get",
}
IMAGE_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
}
CHROME_IMG = ("icons/", "contenttypes", "grey_arrow", "bullet_blue", "atlassian", "expand-control")


def matching_div_end(html: str, start: int) -> int:
    open_tag = html.find("<div", start)
    if open_tag != start:
        raise ValueError("start must point at <div")
    pos = start + 4
    depth = 1
    while pos < len(html) and depth:
        next_open = html.find("<div", pos)
        next_close = html.find("</div>", pos)
        if next_close == -1:
            return len(html)
        if next_open != -1 and next_open < next_close:
            depth += 1
            pos = next_open + 4
        else:
            depth -= 1
            pos = next_close + 6
    return pos


_HTML_TAG_RE = re.compile(
    r"</?(?:a|abbr|b|blockquote|br|code|div|em|h[1-6]|hr|i|img|li|ol|p|pre|"
    r"span|strong|sub|sup|table|tbody|td|th|thead|tr|u|ul|section|article|"
    r"details|summary|colgroup|col)(?:\s[^>]*)?/?>",
    re.I,
)


def strip_heading_num(text: str) -> str:
    return HEADING_NUM_RE.sub("", (text or "").strip(), count=1).strip()


def heading_num_prefix(text: str) -> str:
    match = HEADING_NUM_RE.match((text or "").strip())
    return match.group(1) if match else ""


def decode_entities(text: str) -> str:
    value = html_lib.unescape(text or "")
    if "&amp;" in value or "&#38;" in value or "&#x26;" in value.lower():
        value = html_lib.unescape(value)
    return value


def undouble_amp(html: str) -> str:
    text = html or ""
    while "&amp;amp;" in text:
        text = text.replace("&amp;amp;", "&amp;")
    return text


def strip_tags(text: str) -> str:
    return decode_entities(_HTML_TAG_RE.sub("", text or "")).strip()


def is_pack_ready(html: str) -> bool:
    return any(
        marker in html
        for marker in ('class="content-card"', 'class="page-header"', 'class="hero"', "class='content-card'")
    )


def is_confluence(html: str) -> bool:
    lower = html.lower()
    return any(
        token in lower
        for token in (
            "wiki-content",
            "aui-theme-default",
            "confluencetable",
            "toc-macro",
            "confluence-information-macro",
            "expand-container",
        )
    )


def filename_title(filename: str) -> str:
    stem = re.sub(r"\.(html|docx?)$", "", Path(filename).name, flags=re.I)
    stem = re.sub(r"_\d{6,}$", "", stem)
    stem = re.sub(r"^\d+[_-]?", "", stem)
    stem = stem.replace("%27", "'").replace("-", " ").replace("_", " ")
    return re.sub(r"\s+", " ", stem).strip() or filename


def extract_title(html: str, filename: str) -> str:
    match = re.search(r'id=["\']title-text["\'][^>]*>([\s\S]*?)</span>', html, re.I)
    if match:
        title = re.sub(r"\s+", " ", strip_tags(match.group(1))).strip()
        if title.lower().startswith("space details"):
            title = ""
        elif " : " in title:
            title = title.split(" : ", 1)[1].strip()
        if title:
            return title
    match = re.search(r"<title>([\s\S]*?)</title>", html, re.I)
    if match:
        title = re.sub(r"\s+", " ", strip_tags(match.group(1))).strip()
        if " : " in title:
            title = title.split(" : ", 1)[1].strip()
        title = re.sub(r"\s*\(.*\)\s*$", "", title).strip()
        if title and title.lower() not in {"space details", "space details:"}:
            return title
    match = re.search(r"<h1[^>]*>([\s\S]*?)</h1>", html, re.I)
    if match:
        title = re.sub(r"\s+", " ", strip_tags(match.group(1))).strip()
        if title:
            return title
    return filename_title(filename)


def extract_meta(html: str) -> dict[str, str]:
    match = re.search(r'class=["\']page-metadata["\'][^>]*>([\s\S]*?)</div>', html, re.I)
    if not match:
        return {}
    text = re.sub(r"\s+", " ", strip_tags(match.group(1))).strip()
    meta: dict[str, str] = {}
    created = re.search(r"Created by\s+(.+?)(?:,| on )", text)
    if created:
        meta["author"] = created.group(1).strip()
    modified = re.search(r"on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})", text)
    if modified:
        meta["modified"] = modified.group(1).strip()
    return meta


def extract_fragment(html: str) -> str:
    match = re.search(r'<div[^>]*id=["\']main-content["\'][^>]*>', html, re.I)
    if match:
        end = matching_div_end(html, match.start())
        inner = html[match.start() : end]
        inner = re.sub(r"^<div[^>]*>", "", inner, count=1, flags=re.I)
        inner = re.sub(r"</div>\s*$", "", inner, flags=re.I)
        extra = html[end:]
        if re.search(r"Available Pages:", extra, re.I):
            inner += extra
        return _strip_chrome(inner)
    match = re.search(r'<div[^>]*id=["\']content["\'][^>]*>', html, re.I)
    if match:
        end = matching_div_end(html, match.start())
        inner = html[match.start() : end]
        inner = re.sub(r"^<div[^>]*>", "", inner, count=1, flags=re.I)
        inner = re.sub(r"</div>\s*$", "", inner, flags=re.I)
        return _strip_chrome(inner)
    body = re.search(r"<body[^>]*>([\s\S]*)</body>", html, re.I)
    inner = body.group(1) if body else html
    inner = re.sub(r"<nav[\s\S]*?</nav>", "", inner, count=1, flags=re.I)
    inner = re.sub(r"<script[\s\S]*?</script>", "", inner, flags=re.I)
    inner = re.sub(r"<style[\s\S]*?</style>", "", inner, flags=re.I)
    return _strip_chrome(inner)


def _strip_chrome(inner: str) -> str:
    inner = re.sub(r'<div[^>]*id=["\']breadcrumb-section["\'][\s\S]*?</div>', "", inner, flags=re.I)
    inner = re.sub(r'<ol[^>]*id=["\']breadcrumbs["\'][\s\S]*?</ol>', "", inner, flags=re.I)
    inner = re.sub(r'<div[^>]*class=["\']page-metadata["\'][\s\S]*?</div>', "", inner, count=1, flags=re.I)
    inner = re.sub(r'<h1[^>]*id=["\']title-heading["\'][\s\S]*?</h1>', "", inner, count=1, flags=re.I)
    inner = re.sub(r'<div[^>]*id=["\']footer["\'][\s\S]*?</div>', "", inner, flags=re.I)
    inner = re.sub(r'<div[^>]*class=["\']pageSectionHeader["\'][\s\S]*Attachments:[\s\S]*$', "", inner, flags=re.I)
    return inner.strip()


def attr(node: dict, name: str, default: str = "") -> str:
    want = name.lower()
    for key, value in node.get("attrs") or []:
        if key.lower() == want:
            return decode_entities(value) if value else default
    return default


def class_list(node: dict) -> list[str]:
    return [item for item in (attr(node, "class") or "").split() if item]


def has_class(node: dict, *names: str) -> bool:
    classes = class_list(node)
    return any(name in classes for name in names)


def class_contains(node: dict, token: str) -> bool:
    return any(token in item for item in class_list(node))


def is_el(node, tag: str | None = None) -> bool:
    return isinstance(node, dict) and (tag is None or node.get("tag") == tag)


def text_of(node) -> str:
    if node is None:
        return ""
    if isinstance(node, str):
        return decode_entities(node)
    if node.get("tag") == "br":
        return "\n"
    return "".join(text_of(child) for child in node.get("children") or [])


def whitespace_only(value: str) -> bool:
    return not (value or "").strip()


KNOWN_TAGS = VOID | SKIP_TAGS | INLINE_TAGS | {
    "a", "article", "aside", "blockquote", "body", "button", "caption",
    "col", "colgroup", "dd", "details", "div", "dl", "dt", "fieldset",
    "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5",
    "h6", "header", "hr", "html", "iframe", "label", "legend", "li", "main",
    "nav", "ol", "p", "pre", "section", "summary", "table", "tbody", "td",
    "textarea", "tfoot", "th", "thead", "tr", "ul", "video",
}


class TreeParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = {"tag": "root", "attrs": [], "children": []}
        self.stack = [self.root]
        self.skip: str | None = None

    def handle_starttag(self, tag: str, attrs) -> None:
        tag = tag.lower()
        if tag not in KNOWN_TAGS:
            self.stack[-1]["children"].append(f"<{tag}>")
            return
        node = {"tag": tag, "attrs": list(attrs), "children": []}
        self.stack[-1]["children"].append(node)
        if tag in SKIP_TAGS:
            self.skip = tag
            self.stack.append(node)
            return
        if tag not in VOID:
            self.stack.append(node)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in VOID:
            return
        if tag not in KNOWN_TAGS:
            self.stack[-1]["children"].append(f"</{tag}>")
            return
        if self.skip and tag == self.skip:
            self.skip = None
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index]["tag"] == tag:
                del self.stack[index:]
                return

    def handle_startendtag(self, tag: str, attrs) -> None:
        tag = tag.lower()
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_data(self, data: str) -> None:
        if self.skip:
            return
        self.stack[-1]["children"].append(decode_entities(data))

    def handle_comment(self, data: str) -> None:
        return


def parse_fragment(html: str) -> list:
    parser = TreeParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception:
        pass
    return parser.root["children"]


class Converter:
    def __init__(self, asset_dir: str | Path | None = None, images: dict | None = None) -> None:
        self.asset_dir = Path(asset_dir) if asset_dir else None
        self.images = images or {}
        self.used_ids: set[str] = set()
        self.card_n = 1
        self.h3_n = 0

    def slug(self, text: str) -> str:
        value = re.sub(r"[^a-zA-Z0-9]+", "-", text or "").strip("-").lower()
        value = value[:72] or "section"
        base = value
        n = 2
        while value in self.used_ids:
            value = f"{base}-{n}"
            n += 1
        self.used_ids.add(value)
        return value

    def resolve_src(self, src: str) -> str:
        if not src or src.startswith(("data:", "http://", "https://", "//")):
            return src
        path = src.split("?", 1)[0].replace("\\", "/")
        name = Path(path).name
        for key in (path, name, path.lstrip("./")):
            if key in self.images:
                return self.images[key]
        for key, value in self.images.items():
            norm = str(key).replace("\\", "/")
            if norm.endswith("/" + path) or norm.endswith("/" + name) or norm == path:
                return value
        if self.asset_dir:
            candidates = [
                self.asset_dir / path,
                self.asset_dir / name,
            ]
            for candidate in candidates:
                if candidate.is_file():
                    data = candidate.read_bytes()
                    mime = IMAGE_MIME.get(candidate.suffix.lower(), "application/octet-stream")
                    return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"
        return src

    def is_chrome_image(self, src: str, alt: str = "") -> bool:
        haystack = f"{src} {alt}".lower()
        return any(token in haystack for token in CHROME_IMG)

    def numbered(self, text: str, level: int) -> str:
        cleaned = strip_heading_num(re.sub(r"\s+", " ", text).strip()) or re.sub(r"\s+", " ", text).strip()
        if level == 2:
            return f"{self.card_n}. {cleaned}"
        if level == 3:
            return f"{self.card_n}.{self.h3_n} {cleaned}"
        return cleaned

    def as_heading(self, tag: str, text: str) -> dict:
        node = {"tag": tag, "attrs": [], "children": [text]}
        node["_id"] = self.slug(text)
        return node

    def find_tag(self, node: dict, tag: str):
        if is_el(node, tag):
            return node
        for child in node.get("children") or []:
            if is_el(child):
                found = self.find_tag(child, tag)
                if found:
                    return found
        return None

    def find_class(self, node: dict, token: str):
        if is_el(node) and (has_class(node, token) or class_contains(node, token)):
            return node
        for child in node.get("children") or []:
            if is_el(child):
                found = self.find_class(child, token)
                if found:
                    return found
        return None

    def is_empty(self, node) -> bool:
        if isinstance(node, str):
            return whitespace_only(node)
        if not is_el(node):
            return True
        if node["tag"] == "br":
            return True
        useful = []
        for child in node.get("children") or []:
            if isinstance(child, str):
                if child.strip():
                    useful.append(child)
            elif is_el(child, "br"):
                continue
            elif is_el(child) and child["tag"] in SKIP_TAGS:
                continue
            elif self.is_empty(child):
                continue
            else:
                useful.append(child)
        return not useful

    def unwrap_p(self, nodes: list) -> list:
        if len(nodes) == 1 and is_el(nodes[0], "p"):
            return nodes[0].get("children") or []
        return nodes

    def render_inline(self, nodes: list) -> str:
        out: list[str] = []
        for node in nodes or []:
            if isinstance(node, str):
                out.append(html_lib.escape(decode_entities(node)))
                continue
            if not is_el(node):
                continue
            tag = node["tag"]
            if tag == "br":
                out.append("<br>")
            elif tag in ("strong", "b"):
                out.append(f"<strong>{self.render_inline(node['children'])}</strong>")
            elif tag in ("em", "i"):
                out.append(f"<em>{self.render_inline(node['children'])}</em>")
            elif tag == "code":
                out.append(f"<code>{self.render_inline(node['children'])}</code>")
            elif tag == "a":
                href = attr(node, "href")
                extra = ' target="_blank" rel="noopener"' if href.startswith(("http://", "https://")) else ""
                out.append(
                    f'<a href="{html_lib.escape(href, quote=True)}"{extra}>{self.render_inline(node["children"])}</a>'
                )
            elif tag == "img":
                src = attr(node, "src")
                alt = attr(node, "alt")
                if self.is_chrome_image(src, alt):
                    continue
                resolved = self.resolve_src(src)
                remote = attr(node, "data-image-src")
                if not resolved.startswith("data:") and remote:
                    resolved = self.resolve_src(remote)
                out.append(
                    f'<img src="{html_lib.escape(resolved, quote=True)}" alt="{html_lib.escape(alt, quote=True)}">'
                )
            elif tag == "span":
                classes = class_list(node)
                inner = self.render_inline(node["children"])
                if any("lozenge" in item or "status-macro" in item for item in classes):
                    out.append(f'<span class="badge badge-current">{inner}</span>')
                else:
                    out.append(inner)
            elif tag == "time":
                out.append(self.render_inline(node["children"]))
            else:
                out.append(self.render_inline(node.get("children") or []))
        return "".join(out)

    def decorate_http(self, value: str) -> str:
        raw = value or ""
        code = re.search(r"<code>([\s\S]*?)</code>", raw, re.I)
        if code:
            text = code.group(1)
        else:
            text = raw
        text = html_lib.unescape(text)
        text = re.sub(r"\s+", " ", text).strip()
        match = HTTP_RE.match(text)
        if not match:
            if "<code>" in raw.lower():
                return raw
            return f"<code>{html_lib.escape(text)}</code>" if text else raw
        method = match.group(1).upper()
        url = match.group(2)
        badge = METHOD_BADGE.get(method, "badge-post")
        return f'<span class="badge {badge}">{method}</span> <code>{html_lib.escape(url)}</code>'

    def as_code(self, html: str) -> str:
        value = (html or "").strip()
        if not value or re.search(r"<[a-z]", value, re.I):
            return value
        return f"<code>{value}</code>"

    def labeled_parts(self, node: dict) -> tuple[str, str, str | None] | None:
        extra = ""
        source = node
        if is_el(node, "li"):
            kids = node.get("children") or []
            lists = [item for item in kids if is_el(item) and item["tag"] in {"ul", "ol"}]
            rest = [item for item in kids if not (is_el(item) and item["tag"] in {"ul", "ol"})]
            source = {"tag": "p", "attrs": [], "children": self.unwrap_p(rest)}
            extra = "".join(self.render_list(item) for item in lists)
        raw = self.render_inline(source.get("children") or [])
        plain = re.sub(r"\s+", " ", strip_tags(raw)).strip()
        match = API_LABEL_RE.match(plain)
        if not match:
            return None
        label = LABEL_NAMES.get(match.group(1).lower(), match.group(1))
        html = re.sub(API_LABEL_RE, "", raw, count=1).strip()
        html = re.sub(r"^(<br\s*/?>)+", "", html, flags=re.I).strip()
        if extra:
            html = (html + extra).strip()
        request = None
        code_match = re.search(
            r"(?:<br\s*/?>)?\s*(<code>(GET|POST|PUT|PATCH|DELETE|HEAD)\s+[\s\S]*?</code>)",
            html,
            re.I,
        )
        if code_match:
            request = self.decorate_http(code_match.group(1))
            html = (html[: code_match.start()] + html[code_match.end() :]).strip()
            html = re.sub(r"(<br\s*/?>)+$", "", html, flags=re.I).strip()
        if label == "Request":
            html = self.decorate_http(html)
        elif label in {"API", "Endpoint", "Method"}:
            html = self.as_code(html)
        return label, html, request

    def try_api_paragraphs(self, nodes: list, index: int) -> tuple[list[tuple[str, str]], int]:
        rows: list[tuple[str, str]] = []
        i = index
        while i < len(nodes):
            node = nodes[i]
            if isinstance(node, str) and not node.strip():
                i += 1
                continue
            if not is_el(node, "p"):
                break
            if self.is_empty(node):
                i += 1
                continue
            parts = self.labeled_parts(node)
            if parts:
                label, html, request = parts
                if html:
                    rows.append((label, html))
                if request:
                    rows.append(("Request", request))
                i += 1
                continue
            http = HTTP_RE.match(re.sub(r"\s+", " ", text_of(node)).strip())
            if http and rows:
                rows.append(("Request", self.decorate_http(text_of(node))))
                i += 1
                continue
            break
        if len(rows) < 1:
            return [], index
        labels = {row[0].lower() for row in rows}
        if not labels.intersection({"api", "endpoint", "reference", "request"}):
            return [], index
        return rows, i

    def try_api_list(self, node: dict) -> tuple[str, str, bool]:
        items = [child for child in node.get("children") or [] if is_el(child, "li")]
        if len(items) < 2:
            return "", "", False
        rows: list[tuple[str, str]] = []
        notes: list[str] = []
        payload = False
        api_hits = 0
        for item in items:
            plain = re.sub(r"\s+", " ", text_of(item)).strip()
            parts = self.labeled_parts(item)
            if parts:
                label, html, request = parts
                api_hits += 1
                if html:
                    rows.append((label, html))
                if request:
                    rows.append(("Request", request))
                continue
            if plain.lower().startswith("payload"):
                payload = True
                continue
            if plain.lower().startswith("notes"):
                rest = re.sub(
                    r"^notes\s*:?\s*",
                    "",
                    self.render_inline(self.unwrap_p(item.get("children") or [])),
                    flags=re.I,
                ).strip()
                if rest:
                    notes.append(f"<p>{rest}</p>")
                continue
            if api_hits:
                notes.append(f"<p>{self.render_inline(self.unwrap_p(item.get('children') or []))}</p>")
            else:
                return "", "", False
        if api_hits < 2:
            return "", "", False
        html = self.render_api_box(rows)
        note_html = ""
        if notes:
            note_html = "".join(notes)
        return html, note_html, True

    def try_rule_list(self, node: dict) -> str:
        if not is_el(node, "ul"):
            return ""
        items = [child for child in node.get("children") or [] if is_el(child, "li")]
        if len(items) < 3:
            return ""
        rows: list[tuple[str, str]] = []
        for item in items:
            kids = item.get("children") or []
            if any(is_el(child) and child["tag"] in {"ul", "ol"} for child in kids):
                return ""
            plain = re.sub(r"\s+", " ", text_of(item)).strip()
            parts = re.split(r"\s+[-–—:]\s+", plain, maxsplit=1)
            if len(parts) != 2:
                return ""
            title, desc = parts[0].strip(), parts[1].strip()
            if not title or not desc or len(title) > 48 or title.lower().startswith("notes"):
                return ""
            rows.append((title, desc))
        cards = []
        for title, desc in rows:
            cards.append(
                '<div class="rule-item">'
                f"<h4>{icon_html(icon_for_title(title), 18)} {html_lib.escape(title)}</h4>"
                f"<p>{html_lib.escape(desc)}</p>"
                "</div>"
            )
        return '<div class="rule-grid">\n' + "\n".join(cards) + "\n</div>"

    def try_step_ol(self, node: dict) -> str:
        if not is_el(node, "ol"):
            return ""
        items = [child for child in node.get("children") or [] if is_el(child, "li")]
        if len(items) != 1:
            return ""
        start = attr(node, "start") or "1"
        title = re.sub(r"\s+", " ", text_of(items[0])).strip()
        if not title:
            return ""
        slug = self.slug(title)
        return (
            f'<h3 id="{slug}"><span class="step-badge">{html_lib.escape(start)}</span> '
            f"{html_lib.escape(title)}</h3>"
        )

    def step_heading(self, node: dict) -> tuple[str, str] | None:
        if not is_el(node, "ol"):
            return None
        items = [child for child in node.get("children") or [] if is_el(child, "li")]
        if len(items) != 1:
            return None
        title = re.sub(r"\s+", " ", text_of(items[0])).strip()
        if not title:
            return None
        return attr(node, "start") or "1", title

    def try_notes_list(self, node: dict) -> str:
        items = [child for child in node.get("children") or [] if is_el(child, "li")]
        if not items:
            return ""
        notes = []
        for item in items:
            plain = re.sub(r"\s+", " ", text_of(item)).strip()
            if not re.match(r"^notes\s*:", plain, re.I):
                return ""
            html = self.render_inline(self.unwrap_p(item.get("children") or []))
            html = re.sub(r"^notes\s*:?\s*", "", html, flags=re.I).strip()
            if html:
                notes.append(f"<p>{html}</p>")
        if not notes:
            return ""
        return wrap_callout("\n".join(notes))

    def table_rows(self, node: dict) -> list[list]:
        rows = []
        for child in node.get("children") or []:
            blocks = child.get("children") or [] if is_el(child) and child["tag"] in {"thead", "tbody"} else [child]
            if is_el(child, "tr"):
                blocks = [child]
            for row in blocks:
                if not is_el(row, "tr"):
                    continue
                cells = [cell for cell in row.get("children") or [] if is_el(cell) and cell["tag"] in {"td", "th"}]
                if cells:
                    rows.append(cells)
        return rows

    def try_api_table(self, node: dict) -> str:
        rows = self.table_rows(node)
        if len(rows) < 2:
            return ""
        parsed: list[tuple[str, dict]] = []
        for row in rows:
            if len(row) != 2:
                return ""
            label = re.sub(r"\s+", " ", text_of(row[0])).strip()
            if label.lower() not in LABEL_NAMES:
                return ""
            parsed.append((LABEL_NAMES[label.lower()], row[1]))
        api_rows = []
        for label, cell in parsed:
            inner = self.render_inline(self.unwrap_p(cell.get("children") or [])).strip()
            if label == "Request":
                value = self.decorate_http(inner or text_of(cell))
            elif label in {"API", "Endpoint", "Method"}:
                value = self.as_code(inner) or f"<code>{html_lib.escape(text_of(cell).strip())}</code>"
            else:
                value = inner or f"<code>{html_lib.escape(text_of(cell).strip())}</code>"
            api_rows.append((label, value))
        return self.render_api_box(api_rows)

    def render_api_box(self, rows: list[tuple[str, str]]) -> str:
        seen: set[str] = set()
        parts = []
        for label, value in rows:
            key = f"{label.lower()}::{strip_tags(value)}"
            if key in seen or not value:
                continue
            seen.add(key)
            parts.append(
                '<div class="api-row">'
                f'<span class="api-label">{html_lib.escape(label)}</span>'
                f'<span class="api-value">{value}</span>'
                "</div>"
            )
        if not parts:
            return ""
        return '<div class="api-box">\n' + "\n".join(parts) + "\n</div>"

    def format_code(self, text: str) -> str:
        stripped = text.strip()
        if stripped.startswith(("{", "[")):
            try:
                return json.dumps(json.loads(stripped), indent=2, ensure_ascii=False)
            except Exception:
                return text.strip("\n")
        return text.strip("\n")

    def code_labels(self, text: str, title: str = "") -> tuple[str, str]:
        stripped = text.strip()
        if title:
            label = re.sub(r"^Example[:;]?\s*", "", title, flags=re.I).strip() or title
        elif stripped.startswith(("{", "[")):
            label = "JSON Payload"
        elif HTTP_RE.match(stripped) or stripped.upper().startswith("URI:"):
            label = "HTTP Request"
        else:
            label = "Example"
        sub = ""
        http = HTTP_RE.search(stripped.replace("URI:", "").strip())
        if http:
            sub = f"{http.group(1).upper()} {http.group(2)}"
            if len(sub) > 64:
                sub = http.group(2)[-48:]
        elif stripped.startswith(("{", "[")):
            sub = "JSON"
        return label, sub

    def render_code(self, text: str, title: str = "") -> str:
        formatted = self.format_code(text)
        label, sub = self.code_labels(formatted, title)
        stripped = formatted.lstrip()
        if stripped.startswith(("{", "[")) or "json" in label.lower():
            lang = "json"
        elif HTTP_RE.match(stripped) or stripped.upper().startswith("URI:") or "http" in label.lower():
            lang = "http"
        elif stripped.startswith("<") and not stripped.lower().startswith("<host"):
            lang = "xml"
        else:
            lang = "text"
        return (
            f'<details class="code-fold"><summary>{html_lib.escape(label)}</summary>\n'
            '<div class="code-container">\n'
            f'  <div class="code-header"><span>{html_lib.escape(label)}</span>'
            f"<span>{html_lib.escape(sub)}</span></div>\n"
            f'  <pre><code data-lang="{lang}">{html_lib.escape(formatted)}</code></pre>\n'
            "</div>\n</details>"
        )

    def render_code_panel(self, node: dict, title: str = "") -> str:
        pre = self.find_tag(node, "pre")
        text = text_of(pre) if pre else text_of(node)
        return self.render_code(text, title)

    def is_toc(self, node: dict) -> bool:
        classes = " ".join(class_list(node))
        return "toc-macro" in classes or "rbtoc" in classes

    def is_code_panel(self, node: dict) -> bool:
        classes = class_list(node)
        return "code" in classes and "panel" in classes

    def is_darwin_panel(self, node: dict) -> bool:
        if not has_class(node, "panel"):
            return False
        header = self.find_class(node, "panelHeader")
        title = re.sub(r"\s+", " ", text_of(header)).strip().lower() if header else ""
        return "darwin flow" in title

    def is_layout_wrapper(self, node: dict) -> bool:
        if not is_el(node) or node["tag"] not in {"div", "section", "article", "span"}:
            return False
        if node["tag"] == "span" and not class_contains(node, "confluence-embedded-file-wrapper"):
            return False
        if self.is_toc(node) or self.is_code_panel(node) or self.is_darwin_panel(node):
            return False
        if has_class(node, "panel", "table-wrap", "expand-container", "pageSection"):
            return False
        if class_contains(node, "confluence-information-macro") or class_contains(node, "expand-container"):
            return False
        return True

    def panel_content(self, node: dict) -> dict:
        return self.find_class(node, "panelContent") or node

    def render_info_macro(self, node: dict) -> str:
        classes = " ".join(class_list(node))
        warning = any(token in classes for token in ("warning", "note"))
        body = self.find_class(node, "confluence-information-macro-body") or node
        inner = self.render_flow(body.get("children") or [])
        return wrap_callout(inner, warning) if inner else ""

    def render_panel(self, node: dict) -> str:
        if self.is_darwin_panel(node):
            return self.render_flow((self.panel_content(node).get("children") or []))
        header = self.find_class(node, "panelHeader")
        content = self.panel_content(node)
        header_text = re.sub(r"\s+", " ", text_of(header)).strip() if header else ""
        inner = self.render_flow(content.get("children") or [])
        style = f"{attr(node, 'style')} {attr(content, 'style')}".lower()
        warning = any(token in style for token in ("#ffebe6", "#fffae6", "#fff0b3", "#ffc400", "#ffab00", "#ff8f73"))
        title = f"<p><strong>{html_lib.escape(header_text)}</strong></p>" if header_text else ""
        body_html = f"{title}{inner}"
        return wrap_callout(body_html, warning) if body_html.strip() else ""

    def labeled_code_chunks(self, nodes: list, fallback_title: str) -> list[tuple[str, str]] | None:
        chunks: list[tuple[str, str]] = []
        pending = fallback_title or "Example"
        found = False
        for node in nodes:
            if isinstance(node, str) and not node.strip():
                continue
            if is_el(node, "p") and self.is_empty(node):
                continue
            if is_el(node, "p"):
                label = re.sub(r"\s+", " ", text_of(node)).strip().rstrip(":")
                if label.lower() in {"request", "response", "example"}:
                    pending = label.title()
                    continue
            if is_el(node, "div") and self.is_code_panel(node):
                pre = self.find_tag(node, "pre")
                chunks.append((pending, text_of(pre) if pre else text_of(node)))
                found = True
                pending = fallback_title or "Example"
                continue
            if found:
                return None
        return chunks if chunks else None

    def render_expand(self, node: dict) -> str:
        title = re.sub(r"\s+", " ", text_of(self.find_class(node, "expand-control-text"))).strip() or "Example"
        content = self.find_class(node, "expand-content")
        kids = content.get("children") if content else node.get("children") or []
        chunks = self.labeled_code_chunks(kids, title)
        if chunks:
            return "\n".join(self.render_code(text, label) for label, text in chunks)
        code_only = [
            child
            for child in kids
            if not (isinstance(child, str) and not child.strip())
            and not (is_el(child, "p") and self.is_empty(child))
        ]
        if len(code_only) == 1 and is_el(code_only[0], "div") and self.is_code_panel(code_only[0]):
            return self.render_code_panel(code_only[0], title)
        inner = self.render_flow(kids)
        if not inner.strip():
            return ""
        if re.search(r"<details\b[^>]*\bcode-fold\b", inner, re.I):
            return inner
        return (
            f'<details class="code-fold"><summary>{html_lib.escape(title)}</summary>\n'
            f'<div style="padding:16px 18px">{inner}</div>\n</details>'
        )

    def render_table(self, node: dict) -> str:
        def clean_cell(cell: dict) -> str:
            kids = cell.get("children") or []
            if len(kids) == 1 and is_el(kids[0], "p"):
                inner = self.render_inline(kids[0].get("children") or [])
            else:
                inner = self.render_flow(kids) or self.render_inline(kids)
            tag = "th" if cell["tag"] == "th" or has_class(cell, "confluenceTh") else "td"
            return f"<{tag}>{inner}</{tag}>"

        rows_html = []
        for child in node.get("children") or []:
            if is_el(child, "thead") or is_el(child, "tbody"):
                for row in child.get("children") or []:
                    if is_el(row, "tr"):
                        cells = [clean_cell(cell) for cell in row.get("children") or [] if is_el(cell) and cell["tag"] in {"td", "th"}]
                        if cells:
                            rows_html.append("<tr>" + "".join(cells) + "</tr>")
            elif is_el(child, "tr"):
                cells = [clean_cell(cell) for cell in child.get("children") or [] if is_el(cell) and cell["tag"] in {"td", "th"}]
                if cells:
                    rows_html.append("<tr>" + "".join(cells) + "</tr>")
        if not rows_html:
            return ""
        return '<table class="api-table">\n' + "\n".join(rows_html) + "\n</table>"

    def render_list(self, node: dict) -> str:
        tag = node["tag"]
        start = attr(node, "start")
        start_attr = f' start="{html_lib.escape(start, quote=True)}"' if start and start != "1" else ""
        items = []
        for child in node.get("children") or []:
            if not is_el(child, "li"):
                continue
            inner_nodes = self.unwrap_p(child.get("children") or [])
            nested = []
            inline = []
            for item in inner_nodes:
                if is_el(item) and item["tag"] in {"ul", "ol"}:
                    nested.append(self.render_list(item))
                else:
                    inline.append(item)
            body = self.render_inline(inline).strip()
            extra = "".join(nested)
            if body and extra:
                items.append(f"<li>{body}{extra}</li>")
            elif extra:
                items.append(f"<li>{extra}</li>")
            elif body:
                items.append(f"<li>{body}</li>")
        if not items:
            return ""
        return f"<{tag}{start_attr}>\n" + "\n".join(items) + f"\n</{tag}>"

    def render_diagram(self, img: dict) -> str:
        src = attr(img, "src")
        alt = attr(img, "alt") or attr(img, "data-linked-resource-default-alias") or "Diagram"
        if self.is_chrome_image(src, alt):
            return ""
        resolved = self.resolve_src(src)
        remote = attr(img, "data-image-src")
        if not resolved.startswith("data:") and remote:
            resolved = self.resolve_src(remote)
        src = resolved
        return (
            '<div class="diagram-container">'
            f'<img src="{html_lib.escape(src, quote=True)}" alt="{html_lib.escape(alt, quote=True)}">'
            "</div>"
        )

    def render_div(self, node: dict) -> str:
        if self.is_toc(node):
            return ""
        if has_class(node, "expand-container") or class_contains(node, "expand-container"):
            return self.render_expand(node)
        if class_contains(node, "confluence-information-macro"):
            return self.render_info_macro(node)
        if has_class(node, "table-wrap"):
            table = self.find_tag(node, "table")
            if table:
                return self.try_api_table(table) or self.render_table(table)
            return self.render_flow(node.get("children") or [])
        if self.is_code_panel(node):
            return self.render_code_panel(node)
        if has_class(node, "panel"):
            return self.render_panel(node)
        if has_class(node, "pageSection"):
            title = text_of(self.find_class(node, "pageSectionTitle"))
            if title.lower().startswith("attachment"):
                return ""
            return self.render_flow(node.get("children") or [])
        return self.render_flow(node.get("children") or [])

    def render_heading(self, node: dict) -> str:
        text = re.sub(r"\s+", " ", text_of(node)).strip()
        if not text:
            return ""
        tag = node["tag"]
        if tag == "h1":
            tag = "h2"
        slug = node.get("_id") or self.slug(text)
        if tag == "h3":
            self.h3_n += 1
            title = self.numbered(text, 3)
        elif tag == "h2":
            title = self.numbered(text, 2)
        else:
            title = html_lib.escape(text)
            return f'<{tag} id="{slug}">{title}</{tag}>'
        return f'<{tag} id="{slug}">{html_lib.escape(title)}</{tag}>'

    def render_flow(self, nodes: list) -> str:
        out: list[str] = []
        i = 0
        items = nodes or []
        while i < len(items):
            node = items[i]
            if isinstance(node, str):
                if node.strip():
                    out.append(f"<p>{html_lib.escape(decode_entities(node.strip()))}</p>")
                i += 1
                continue
            if not is_el(node):
                i += 1
                continue
            tag = node["tag"]
            if tag in SKIP_TAGS:
                i += 1
                continue
            rows, nxt = self.try_api_paragraphs(items, i)
            if rows:
                out.append(self.render_api_box(rows))
                i = nxt
                continue
            if tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
                rendered = self.render_heading(node)
                if rendered:
                    out.append(rendered)
                i += 1
                continue
            if tag == "p":
                if self.is_empty(node):
                    i += 1
                    continue
                out.append(f"<p>{self.render_inline(node.get('children') or [])}</p>")
                i += 1
                continue
            if tag in {"ul", "ol"}:
                api_html, notes, is_api = self.try_api_list(node) if tag == "ul" else ("", "", False)
                if is_api:
                    out.append(api_html)
                    if notes:
                        out.append(wrap_callout(notes))
                    i += 1
                    continue
                notes_only = self.try_notes_list(node) if tag == "ul" else ""
                if notes_only:
                    out.append(notes_only)
                    i += 1
                    continue
                rules = self.try_rule_list(node) if tag == "ul" else ""
                if rules:
                    out.append(rules)
                    i += 1
                    continue
                step = self.try_step_ol(node)
                if step:
                    out.append(step)
                    i += 1
                    continue
                rendered = self.render_list(node)
                if rendered:
                    out.append(rendered)
                i += 1
                continue
            if tag == "div":
                rendered = self.render_div(node)
                if rendered:
                    out.append(rendered)
                i += 1
                continue
            if tag == "table":
                rendered = self.try_api_table(node) or self.render_table(node)
                if rendered:
                    out.append(rendered)
                i += 1
                continue
            if tag == "pre":
                text = text_of(node)
                if text.strip():
                    out.append(self.render_code(text))
                i += 1
                continue
            if tag == "span" and class_contains(node, "confluence-embedded-file-wrapper"):
                img = self.find_tag(node, "img")
                if img:
                    rendered = self.render_diagram(img)
                    if rendered:
                        out.append(rendered)
                i += 1
                continue
            if tag == "img":
                rendered = self.render_diagram(node)
                if rendered:
                    out.append(rendered)
                i += 1
                continue
            if tag in {"section", "article", "blockquote"}:
                rendered = self.render_flow(node.get("children") or [])
                if rendered:
                    if tag == "blockquote":
                        out.append(wrap_callout(rendered))
                    else:
                        out.append(rendered)
                i += 1
                continue
            rendered = self.render_flow(node.get("children") or [])
            if rendered:
                out.append(rendered)
            i += 1
        return "\n".join(part for part in out if part and str(part).strip())

    def flatten_top(self, nodes: list) -> list:
        out: list = []
        for node in nodes or []:
            if isinstance(node, str):
                if node.strip():
                    out.append(node)
                continue
            if not is_el(node):
                continue
            if node["tag"] in SKIP_TAGS or self.is_toc(node):
                continue
            if is_el(node, "p") and self.is_empty(node):
                continue
            if is_el(node, "div") and self.is_darwin_panel(node):
                out.extend(self.flatten_top(self.panel_content(node).get("children") or []))
                continue
            if self.is_layout_wrapper(node):
                out.extend(self.flatten_top(node.get("children") or []))
                continue
            out.append(node)
        return out

    def split_sections(self, nodes: list) -> list[dict]:
        flat = self.flatten_top(nodes)
        sections: list[dict] = []
        current = {"title": "", "nodes": [], "step": ""}
        last_top = 0
        seq = 0

        def close() -> None:
            if current["title"] or current["nodes"]:
                sections.append(current)

        def open_section(title: str, step: str = "") -> None:
            nonlocal current, last_top, seq
            close()
            seq += 1
            prefix = heading_num_prefix(title) or str(step or "")
            top = 0
            if prefix:
                try:
                    top = int(prefix.split(".", 1)[0])
                except ValueError:
                    top = 0
            last_top = max(last_top, top, seq)
            current = {"title": title, "nodes": [], "step": step}

        for node in flat:
            step = self.step_heading(node) if is_el(node) else None
            if is_el(node) and node["tag"] in {"h1", "h2"}:
                open_section(re.sub(r"\s+", " ", text_of(node)).strip())
                continue
            if step:
                number, title = step
                try:
                    start = int(str(number).split(".", 1)[0])
                except ValueError:
                    start = 0
                restart = bool(current["title"]) and last_top > 1 and start and start <= last_top and (
                    start < last_top or start == 1
                )
                if restart:
                    current["nodes"].append(self.as_heading("h3", title))
                    continue
                open_section(title, str(number))
                continue
            current["nodes"].append(node)
        close()
        prepared = []
        for index, section in enumerate(sections, 1):
            title = section["title"]
            if not title:
                title = "Overview" if index == 1 else f"Section {index}"
            section["title"] = title
            section["id"] = self.slug(strip_heading_num(title) or title)
            section["number"] = index
            for node in section["nodes"]:
                if is_el(node, "h3"):
                    node["_id"] = node.get("_id") or self.slug(
                        strip_heading_num(re.sub(r"\s+", " ", text_of(node)).strip())
                        or re.sub(r"\s+", " ", text_of(node)).strip()
                    )
            prepared.append(section)
        return prepared

    def toc_html(self, sections: list[dict]) -> str:
        if len(sections) < 2:
            return ""
        items = []
        for section in sections:
            subs = []
            h3 = 0
            plain_title = strip_heading_num(section["title"]) or section["title"]
            for node in section["nodes"]:
                if is_el(node, "h3"):
                    h3 += 1
                    text = re.sub(r"\s+", " ", text_of(node)).strip()
                    label = f"{section['number']}.{h3} {strip_heading_num(text) or text}"
                    subs.append(f'<li><a href="#{node["_id"]}">{html_lib.escape(label)}</a></li>')
            nested = f"<ul>\n{''.join(subs)}\n</ul>" if subs else ""
            self.card_n = section["number"]
            label = f"{section['number']}. {plain_title}"
            items.append(
                f'<li><a href="#{section["id"]}">{html_lib.escape(label)}</a>{nested}</li>'
            )
        return (
            '<div class="toc-card">\n'
            f'<h3>{icon_html("list")} Table of Contents</h3>\n<ul>\n'
            + "\n".join(items)
            + "\n</ul>\n</div>"
        )

    def page_header(self, title: str, meta: dict[str, str], description: str = "") -> str:
        items = []
        if meta.get("author"):
            items.append(f"<span><strong>Author:</strong> {html_lib.escape(meta['author'])}</span>")
        if meta.get("modified"):
            items.append(
                f"<span><strong>Last modified:</strong> {html_lib.escape(meta['modified'])}</span>"
            )
        desc_html = f"<p>{html_lib.escape(description)}</p>\n" if description else ""
        meta_html = f'<div class="hero-meta">\n{" ".join(items)}\n</div>\n' if items else ""
        return (
            '<header class="hero">\n'
            f"<h1>{html_lib.escape(title)}</h1>\n"
            f"{desc_html}"
            f"{meta_html}"
            "</header>"
        )

    def render_sections(self, sections: list[dict]) -> str:
        cards = []
        for section in sections:
            self.card_n = section["number"]
            self.h3_n = 0
            plain = strip_heading_num(section["title"]) or section["title"]
            if section.get("step"):
                heading = (
                    f'<h2 id="{section["id"]}">'
                    f'<span class="step-badge">{html_lib.escape(str(section["number"]))}</span> '
                    f"{html_lib.escape(plain)}</h2>"
                )
            else:
                heading = (
                    f'<h2 id="{section["id"]}">{icon_html(icon_for_title(section["title"]))} '
                    f"{html_lib.escape(self.numbered(section['title'], 2))}</h2>"
                )
            body = self.render_flow(section["nodes"])
            cards.append(f'<div class="content-card" id="{section["id"]}-card">\n{heading}\n{body}\n</div>')
        return "\n".join(cards)

    def convert_space_index(self, html: str, title: str, meta: dict[str, str]) -> str:
        return self.page_header(title, meta)

    def convert(self, raw: str, filename: str) -> dict:
        title = extract_title(raw, filename)
        meta = extract_meta(raw)
        fragment = extract_fragment(raw)
        if "Available Pages:" in raw and ("Space Details" in raw or Path(filename).name.lower() == "index.html"):
            space = title if title.lower() not in {"space details", "eps"} else "Edenred Payment Solutions"
            if "Edenred Payment Solutions" in raw and title.lower() in {"space details", "eps", ""}:
                space = "Edenred Payment Solutions"
            return {
                "title": space,
                "body": self.convert_space_index(raw, space, meta),
                "role": "overview",
            }
        nodes = parse_fragment(fragment)
        sections = self.split_sections(nodes)
        if not sections:
            body = "\n".join(
                part
                for part in (
                    self.page_header(title, meta),
                    '<div class="content-card"><p>This page had no body content in the Confluence export.</p></div>',
                )
                if part
            )
            return {"title": title, "body": body, "role": "chapter"}
        header = self.page_header(title, meta)
        toc = self.toc_html(sections)
        cards = self.render_sections(sections)
        role = "overview" if Path(filename).stem.lower() in {"index"} else "chapter"
        return {"title": title, "body": "\n".join(part for part in (header, toc, cards) if part), "role": role}


def convert_document(raw: str, filename: str, asset_dir: str | Path | None = None, images: dict | None = None) -> dict:
    return Converter(asset_dir=asset_dir, images=images).convert(raw, filename)
