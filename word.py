"""Turn a Word .doc or .docx file into HTML that convert_document can restyle."""
from __future__ import annotations

import base64
import html as html_lib
import io
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from email import message_from_bytes
from pathlib import Path
from xml.etree import ElementTree as ET

WORD_SUFFIXES = {".doc", ".docx"}
OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
DOC_CONVERT_ERROR = (
    "Old Word .doc files need Microsoft Word or LibreOffice installed so Pack "
    "Builder can convert them. Open the file in Word, save it as .docx, and "
    "drop that instead."
)

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
WP = "{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}"
REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
V = "{urn:schemas-microsoft-com:vml}"

IMAGE_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".emf": "image/x-emf",
    ".wmf": "image/x-wmf",
}
CODE_FONTS = {
    "consolas",
    "courier new",
    "courier",
    "cascadia code",
    "cascadia mono",
    "menlo",
    "monaco",
    "source code pro",
    "fira code",
    "jetbrains mono",
}
HTTP_RE = re.compile(r"^\s*(GET|POST|PUT|PATCH|DELETE|HEAD)\s+\S+", re.I)


def _val(el: ET.Element | None, name: str = "val") -> str:
    if el is None:
        return ""
    return el.get(f"{W}{name}") or el.get(name) or ""


def _local(tag: str) -> str:
    return tag.split("}", 1)[-1]


def _text(el: ET.Element | None) -> str:
    if el is None:
        return ""
    parts = []
    for node in el.iter():
        if node.tag == f"{W}t" and node.text:
            parts.append(node.text)
        elif node.tag == f"{W}tab":
            parts.append("\t")
        elif node.tag == f"{W}br":
            parts.append("\n")
    return html_lib.unescape("".join(parts))


def is_word_name(name: str) -> bool:
    return Path(name).suffix.lower() in WORD_SUFFIXES


def looks_like_mhtml(data: bytes) -> bool:
    head = data.lstrip()[:4000].lower()
    return (
        b"mime-version:" in head
        or b"content-type: multipart/" in head
        or b"exported from confluence" in head
        or head.startswith((b"date:", b"message-id:", b"from:", b"subject:"))
    )


def looks_like_html(data: bytes) -> bool:
    head = data.lstrip().lstrip(b"\xef\xbb\xbf")[:200].lower()
    return head.startswith((b"<!doctype html", b"<html", b"<meta charset"))


def _sniff_mime(payload: bytes) -> str:
    if payload.startswith(b"\x89PNG"):
        return "image/png"
    if payload[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if payload[:6] in {b"GIF87a", b"GIF89a"}:
        return "image/gif"
    stripped = payload.lstrip()
    if stripped.startswith(b"<svg") or stripped.startswith(b"<?xml"):
        return "image/svg+xml"
    return "application/octet-stream"


def mhtml_to_html(data: bytes) -> tuple[str, dict[str, str]]:
    message = message_from_bytes(data)
    html = ""
    images: dict[str, str] = {}
    for part in message.walk():
        ctype = (part.get_content_type() or "").lower()
        payload = part.get_payload(decode=True) or b""
        location = (part.get("Content-Location") or "").strip()
        cid = (part.get("Content-ID") or "").strip().strip("<>")
        filename = part.get_filename() or ""
        name = Path(location.replace("\\", "/")).name if location else filename
        if ctype == "text/html" and payload and not html:
            charset = part.get_content_charset() or "utf-8"
            html = payload.decode(charset, "replace")
            continue
        if not payload or ctype.startswith("multipart/"):
            continue
        mime = ctype if ctype.startswith("image/") else _sniff_mime(payload)
        if not mime.startswith("image/"):
            mime = _sniff_mime(payload)
        if not mime.startswith("image/"):
            continue
        uri = f"data:{mime};base64,{base64.b64encode(payload).decode('ascii')}"
        keys = {name, filename, location, cid}
        if location.startswith("file:///"):
            keys.add(location[8:])
            keys.add(Path(location[8:].replace("\\", "/")).name)
        if cid:
            keys.add(f"cid:{cid}")
        for key in keys:
            if key:
                images[key] = uri
    if not html.strip():
        raise ValueError("That Word export had no HTML page content")
    return html, images


def word_to_html(data: bytes, filename: str = "document.docx") -> tuple[str, dict[str, str]]:
    if not data:
        raise ValueError("Word file is empty")
    if looks_like_mhtml(data):
        return mhtml_to_html(data)
    if looks_like_html(data):
        charset = "utf-8"
        if data.startswith(b"\xff\xfe"):
            charset = "utf-16-le"
        elif data.startswith(b"\xfe\xff"):
            charset = "utf-16-be"
        return data.decode(charset, "replace"), {}
    if data[:2] == b"PK":
        return docx_to_html(data, filename)
    suffix = Path(filename).suffix.lower()
    if data[:8] == OLE_MAGIC or suffix == ".doc":
        try:
            converted = doc_to_docx_bytes(data, filename)
            return docx_to_html(converted, f"{Path(filename).stem}.docx")
        except ValueError:
            if b"<html" in data[:8000].lower() or b"multipart/" in data[:4000].lower():
                if looks_like_mhtml(data) or b"mime-version:" in data[:4000].lower():
                    return mhtml_to_html(data)
                return data.decode("utf-8", "replace"), {}
            raise
    raise ValueError("That file is not a valid Word document (.doc or .docx)")


def doc_to_docx_bytes(data: bytes, filename: str = "document.doc") -> bytes:
    suffix = Path(filename).suffix.lower() if Path(filename).suffix else ".doc"
    if suffix not in {".doc", ".docx"}:
        suffix = ".doc"
    with tempfile.TemporaryDirectory(prefix="pack-doc-") as raw_tmp:
        tmp = Path(raw_tmp)
        source = tmp / f"source{suffix}"
        dest = tmp / "converted.docx"
        source.write_bytes(data)
        if _word_com_to_docx(source, dest) or _libreoffice_to_docx(source, dest):
            converted = dest.read_bytes()
            if converted[:2] == b"PK":
                return converted
        raise ValueError(DOC_CONVERT_ERROR)


def _hidden_run(command: list[str], timeout: int = 120) -> subprocess.CompletedProcess:
    extra: dict = {}
    if os.name == "nt":
        extra["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=timeout,
        **extra,
    )


def _word_com_to_docx(source: Path, dest: Path) -> bool:
    if os.name != "nt":
        return False
    script = dest.with_name("convert.ps1")
    script.write_text(
        "param([string]$InPath, [string]$OutPath)\n"
        "$ErrorActionPreference = 'Stop'\n"
        "$word = $null\n"
        "$document = $null\n"
        "try {\n"
        "  $word = New-Object -ComObject Word.Application\n"
        "  $word.Visible = $false\n"
        "  $word.DisplayAlerts = 0\n"
        "  $document = $word.Documents.Open([string]$InPath, $false, $true, $false)\n"
        "  try {\n"
        "    $document.SaveAs2([string]$OutPath, 16)\n"
        "  } catch {\n"
        "    $out = [string]$OutPath\n"
        "    $fmt = 16\n"
        "    $document.SaveAs([ref]$out, [ref]$fmt)\n"
        "  }\n"
        "} finally {\n"
        "  if ($document -ne $null) { $document.Close($false) | Out-Null }\n"
        "  if ($word -ne $null) { $word.Quit() | Out-Null }\n"
        "}\n",
        encoding="utf-8",
    )
    try:
        result = _hidden_run(
            [
                "powershell",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(script),
                str(source),
                str(dest),
            ]
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0 and dest.is_file() and dest.stat().st_size > 4


def _libreoffice_to_docx(source: Path, dest: Path) -> bool:
    exe = shutil.which("soffice") or shutil.which("soffice.exe") or shutil.which("libreoffice")
    if not exe:
        for base in (
            os.environ.get("PROGRAMFILES", r"C:\Program Files"),
            os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"),
        ):
            candidate = Path(base) / "LibreOffice" / "program" / "soffice.exe"
            if candidate.is_file():
                exe = str(candidate)
                break
    if not exe:
        return False
    try:
        result = _hidden_run(
            [
                exe,
                "--headless",
                "--nologo",
                "--nofirststartwizard",
                "--convert-to",
                "docx",
                "--outdir",
                str(dest.parent),
                str(source),
            ]
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    produced = source.with_suffix(".docx")
    if produced != dest and produced.is_file():
        produced.replace(dest)
    return result.returncode == 0 and dest.is_file() and dest.stat().st_size > 4


def docx_to_html(data: bytes, filename: str = "document.docx") -> tuple[str, dict[str, str]]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ValueError("That file is not a valid Word document (.doc or .docx)") from exc
    names = set(archive.namelist())
    if "word/document.xml" not in names:
        raise ValueError("That Word file has no document.xml body")

    styles_raw = archive.read("word/styles.xml") if "word/styles.xml" in names else b""
    styles = _styles(styles_raw)
    style_num_ids = _style_num_ids(styles_raw)
    numbering = _numbering(archive.read("word/numbering.xml") if "word/numbering.xml" in names else b"")
    rels = _rels(archive.read("word/_rels/document.xml.rels") if "word/_rels/document.xml.rels" in names else b"")
    images = _images(archive, rels)
    core = _core(archive.read("docProps/core.xml") if "docProps/core.xml" in names else b"")
    body = ET.fromstring(archive.read("word/document.xml")).find(f"{W}body")
    if body is None:
        raise ValueError("That Word file has an empty body")

    blocks = _blocks(_flatten_body(body), styles, numbering, rels, images, style_num_ids)
    title = core.get("title") or _first_heading(blocks) or Path(filename).stem.replace("_", " ")
    html = [
        f"<!DOCTYPE html><html><head><title>{html_lib.escape(title)}</title></head><body>",
        f"<h1>{html_lib.escape(title)}</h1>",
    ]
    if core.get("author") or core.get("modified"):
        meta = []
        if core.get("author"):
            meta.append(f"Created by {html_lib.escape(core['author'])}")
        if core.get("modified"):
            meta.append(f"on {html_lib.escape(core['modified'])}")
        html.append(f'<div class="page-metadata">{", ".join(meta)}</div>')
    html.append(_blocks_to_html(blocks, title))
    html.append("</body></html>")
    return "\n".join(html), images


def _styles(raw: bytes) -> dict[str, str]:
    found: dict[str, str] = {}
    if not raw:
        return found
    root = ET.fromstring(raw)
    for style in root.findall(f"{W}style"):
        style_id = style.get(f"{W}styleId") or style.get("styleId") or ""
        name = _val(style.find(f"{W}name"))
        if style_id:
            found[style_id] = name or style_id
    return found


def _style_num_ids(raw: bytes) -> dict[str, str]:
    """Map styleId -> numId for styles that carry their own list numbering.

    Word can apply bullet/number formatting either directly on a paragraph
    (<w:pPr><w:numPr>) or via a named style (e.g. pStyle="ListBullet") whose
    *style definition* carries the numPr instead. _list_info only sees the
    paragraph, so this lets it fall back to the style's numbering when the
    paragraph has none of its own.
    """
    found: dict[str, str] = {}
    if not raw:
        return found
    root = ET.fromstring(raw)
    for style in root.findall(f"{W}style"):
        style_id = style.get(f"{W}styleId") or style.get("styleId") or ""
        if not style_id:
            continue
        ppr = style.find(f"{W}pPr")
        numpr = ppr.find(f"{W}numPr") if ppr is not None else None
        num_id = _val(numpr.find(f"{W}numId")) if numpr is not None else ""
        if num_id:
            found[style_id] = num_id
    return found


def _numbering(raw: bytes) -> dict[str, str]:
    fmt: dict[str, str] = {}
    if not raw:
        return fmt
    root = ET.fromstring(raw)
    abstracts: dict[str, str] = {}
    for abstract in root.findall(f"{W}abstractNum"):
        aid = abstract.get(f"{W}abstractNumId") or abstract.get("abstractNumId") or ""
        lvl = abstract.find(f"{W}lvl")
        num_fmt = _val(lvl.find(f"{W}numFmt") if lvl is not None else None) or "bullet"
        abstracts[aid] = num_fmt
    for num in root.findall(f"{W}num"):
        nid = num.get(f"{W}numId") or num.get("numId") or ""
        aid = _val(num.find(f"{W}abstractNumId"))
        fmt[nid] = abstracts.get(aid, "bullet")
    return fmt


def _rels(raw: bytes) -> dict[str, dict[str, str]]:
    found: dict[str, dict[str, str]] = {}
    if not raw:
        return found
    root = ET.fromstring(raw)
    for rel in root:
        rid = rel.get("Id") or ""
        if rid:
            found[rid] = {"target": rel.get("Target") or "", "type": rel.get("Type") or ""}
    return found


def _images(archive: zipfile.ZipFile, rels: dict[str, dict[str, str]]) -> dict[str, str]:
    images: dict[str, str] = {}
    for rel in rels.values():
        if "/image" not in rel["type"].lower():
            continue
        target = rel["target"].replace("\\", "/")
        zip_name = target if target.startswith("word/") else f"word/{target.lstrip('./')}"
        try:
            blob = archive.read(zip_name)
        except KeyError:
            continue
        mime = IMAGE_MIME.get(Path(target).suffix.lower(), "application/octet-stream")
        uri = f"data:{mime};base64,{base64.b64encode(blob).decode('ascii')}"
        name = Path(target).name
        images[name] = uri
        images[target] = uri
        images[zip_name] = uri
        images[f"media/{name}"] = uri
    return images


def _core(raw: bytes) -> dict[str, str]:
    meta: dict[str, str] = {}
    if not raw:
        return meta
    root = ET.fromstring(raw)
    ns = {
        "dc": "http://purl.org/dc/elements/1.1/",
        "dcterms": "http://purl.org/dc/terms/",
        "cp": "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
    }
    title = root.find("dc:title", ns)
    creator = root.find("dc:creator", ns)
    modified = root.find("dcterms:modified", ns)
    if title is not None and (title.text or "").strip():
        meta["title"] = title.text.strip()
    if creator is not None and (creator.text or "").strip():
        meta["author"] = creator.text.strip()
    if modified is not None and (modified.text or "").strip():
        meta["modified"] = modified.text.strip()[:10]
    return meta


def _style_name(p: ET.Element, styles: dict[str, str]) -> str:
    ppr = p.find(f"{W}pPr")
    if ppr is None:
        return ""
    style_id = _val(ppr.find(f"{W}pStyle"))
    return (styles.get(style_id) or style_id or "").strip()


def _heading_level(style: str) -> int:
    key = re.sub(r"[\s_-]+", "", style.lower())
    match = re.search(r"heading(\d)", key)
    if match:
        return max(1, min(6, int(match.group(1))))
    if key in {"title"}:
        return 1
    if key in {"subtitle"}:
        return 2
    return 0


def _list_info(
    p: ET.Element, numbering: dict[str, str], style_num_ids: dict[str, str] | None = None
) -> tuple[str, str] | None:
    ppr = p.find(f"{W}pPr")
    if ppr is None:
        return None
    numpr = ppr.find(f"{W}numPr")
    num_id = _val(numpr.find(f"{W}numId")) if numpr is not None else ""
    if not num_id and style_num_ids:
        # No direct per-paragraph numbering - fall back to whatever the
        # paragraph's own style declares (see _style_num_ids).
        style_id = _val(ppr.find(f"{W}pStyle"))
        num_id = style_num_ids.get(style_id, "")
    if not num_id or num_id == "0":
        return None
    fmt = numbering.get(num_id, "bullet").lower()
    tag = "ol" if fmt in {"decimal", "decimalzero", "upperroman", "lowerroman", "upperletter", "lowerletter"} else "ul"
    return tag, num_id


def _run_fonts(p: ET.Element) -> set[str]:
    fonts: set[str] = set()
    for fonts_el in p.iter(f"{W}rFonts"):
        for attr in ("ascii", "hAnsi", "cs", f"{W}ascii", f"{W}hAnsi"):
            raw = fonts_el.get(attr) or fonts_el.get(attr.split("}")[-1]) or ""
            if raw:
                fonts.add(raw.lower())
    return fonts


def _is_code(style: str, fonts: set[str], text: str) -> bool:
    key = re.sub(r"[\s_-]+", "", style.lower())
    if any(token in key for token in ("code", "htmlpre", "sourcecode", "verbatim", "preformatted")):
        return True
    if fonts & CODE_FONTS:
        return True
    stripped = text.strip()
    if HTTP_RE.match(stripped) or stripped.upper().startswith("URI:"):
        return True
    if stripped.startswith(("{", "[")) and len(stripped) > 12:
        return True
    return False


def _is_quote(style: str) -> bool:
    key = re.sub(r"[\s_-]+", "", style.lower())
    return "quote" in key or key in {"intensequote", "blockquote"}


def _blip_rid(el: ET.Element) -> str:
    rid = el.get(f"{R}embed") or el.get(f"{R}link") or ""
    if rid:
        return rid
    for child in el.iter():
        rid = child.get(f"{R}embed") or child.get(f"{R}link") or ""
        if rid:
            return rid
    return ""


def _image_names(el: ET.Element, rels: dict[str, dict[str, str]], images: dict[str, str]) -> list[str]:
    names: list[str] = []
    for node in el.iter():
        rid = ""
        if node.tag.endswith("}blip") or node.tag.endswith("}imagedata"):
            rid = _blip_rid(node)
        if not rid:
            continue
        target = (rels.get(rid) or {}).get("target") or ""
        name = Path(target).name
        if name and name in images:
            names.append(name)
        elif target:
            names.append(Path(target).name)
    return names


def _inline_html(p: ET.Element, rels: dict[str, dict[str, str]]) -> str:
    parts: list[str] = []

    def wrap_run(run: ET.Element, inner: str) -> str:
        if not inner:
            return ""
        rpr = run.find(f"{W}rPr")
        html = inner
        if rpr is not None:
            if rpr.find(f"{W}b") is not None or rpr.find(f"{W}bCs") is not None:
                html = f"<strong>{html}</strong>"
            if rpr.find(f"{W}i") is not None or rpr.find(f"{W}iCs") is not None:
                html = f"<em>{html}</em>"
            if rpr.find(f"{W}u") is not None:
                html = f"<u>{html}</u>"
            fonts = _run_fonts(run)
            if fonts & CODE_FONTS:
                html = f"<code>{html}</code>"
        return html

    def emit_run(run: ET.Element) -> None:
        for drawing in run.iter():
            if drawing.tag.endswith("}drawing") or drawing.tag.endswith("}pict"):
                return
        text = ""
        for node in run:
            if node.tag == f"{W}t":
                text += node.text or ""
            elif node.tag == f"{W}tab":
                text += " "
            elif node.tag == f"{W}br":
                parts.append("<br>")
        if text:
            parts.append(wrap_run(run, html_lib.escape(text)))

    for child in p:
        tag = _local(child.tag)
        if tag == "r":
            emit_run(child)
        elif tag == "hyperlink":
            rid = child.get(f"{R}id") or ""
            href = (rels.get(rid) or {}).get("target") or child.get(f"{W}anchor") or ""
            inner = []
            for run in child.findall(f"{W}r"):
                piece = html_lib.escape(_text(run))
                if piece:
                    inner.append(wrap_run(run, piece))
            label = "".join(inner) or html_lib.escape(_text(child))
            if href.startswith("http") or href.startswith("mailto:"):
                parts.append(f'<a href="{html_lib.escape(href, quote=True)}">{label}</a>')
            else:
                parts.append(label)
        elif tag == "ins" or tag == "smartTag":
            for run in child.findall(f"{W}r"):
                emit_run(run)
    return "".join(parts).strip()


def _flatten_body(body: ET.Element) -> list[ET.Element]:
    out: list[ET.Element] = []

    def walk(parent: ET.Element) -> None:
        for child in parent:
            tag = _local(child.tag)
            if tag in {"sdt", "sdtContent", "customXml", "smartTag"}:
                walk(child if tag != "sdt" else child.find(f"{W}sdtContent") or child)
            elif tag in {"p", "tbl"}:
                out.append(child)
            elif tag == "sectPr":
                continue
            else:
                walk(child)

    walk(body)
    return out


def _blocks(
    children: list[ET.Element],
    styles: dict[str, str],
    numbering: dict[str, str],
    rels: dict[str, dict[str, str]],
    images: dict[str, str],
    style_num_ids: dict[str, str] | None = None,
) -> list[dict]:
    blocks: list[dict] = []
    for child in children:
        tag = _local(child.tag)
        if tag == "tbl":
            blocks.append({"kind": "table", "rows": _table_rows(child, rels)})
            continue
        if tag != "p":
            continue
        style = _style_name(child, styles)
        text = _text(child).strip()
        imgs = _image_names(child, rels, images)
        if not text and not imgs:
            continue
        if text.startswith("TOC \\") or "PAGEREF" in text:
            continue
        if imgs and not text:
            for name in imgs:
                blocks.append({"kind": "img", "src": name})
            continue
        level = _heading_level(style)
        if level:
            blocks.append({"kind": "h", "level": level, "text": text})
            continue
        if _is_code(style, _run_fonts(child), text):
            if blocks and blocks[-1]["kind"] == "code":
                blocks[-1]["text"] += "\n" + text
            else:
                blocks.append({"kind": "code", "text": text})
            continue
        if _is_quote(style):
            blocks.append({"kind": "quote", "html": _inline_html(child, rels) or html_lib.escape(text)})
            continue
        listed = _list_info(child, numbering, style_num_ids)
        if listed:
            tag_name, num_id = listed
            blocks.append(
                {
                    "kind": "li",
                    "tag": tag_name,
                    "num_id": num_id,
                    "html": _inline_html(child, rels) or html_lib.escape(text),
                }
            )
            continue
        html = _inline_html(child, rels) or html_lib.escape(text)
        for name in imgs:
            html += f'<img src="{html_lib.escape(name, quote=True)}" alt="">'
        blocks.append({"kind": "p", "html": html})
    return blocks


def _table_rows(tbl: ET.Element, rels: dict[str, dict[str, str]]) -> list[list[str]]:
    rows: list[list[str]] = []
    for tr in tbl.findall(f"{W}tr"):
        cells = []
        for tc in tr.findall(f"{W}tc"):
            paras = []
            for p in tc.findall(f"{W}p"):
                inner = _inline_html(p, rels) or html_lib.escape(_text(p).strip())
                if inner:
                    paras.append(inner)
            cells.append("<br>".join(paras))
        if any(cell.strip() for cell in cells):
            rows.append(cells)
    return rows


def _first_heading(blocks: list[dict]) -> str:
    for block in blocks:
        if block["kind"] == "h" and block.get("level") == 1:
            return block["text"]
    for block in blocks:
        if block["kind"] == "h":
            return block["text"]
    return ""


def _blocks_to_html(blocks: list[dict], title: str) -> str:
    out: list[str] = []
    i = 0
    skipped_title = False
    while i < len(blocks):
        block = blocks[i]
        kind = block["kind"]
        if kind == "h" and not skipped_title and block.get("level") == 1 and block["text"].strip() == title.strip():
            skipped_title = True
            i += 1
            continue
        if kind == "h":
            level = max(1, min(6, int(block["level"])))
            out.append(f"<h{level}>{html_lib.escape(block['text'])}</h{level}>")
            i += 1
            continue
        if kind == "p":
            out.append(f"<p>{block['html']}</p>")
            i += 1
            continue
        if kind == "quote":
            out.append(f"<blockquote><p>{block['html']}</p></blockquote>")
            i += 1
            continue
        if kind == "code":
            out.append(f"<pre><code>{html_lib.escape(block['text'])}</code></pre>")
            i += 1
            continue
        if kind == "img":
            out.append(f'<p><img src="{html_lib.escape(block["src"], quote=True)}" alt=""></p>')
            i += 1
            continue
        if kind == "table":
            out.append(_table_html(block["rows"]))
            i += 1
            continue
        if kind == "li":
            tag = block["tag"]
            num_id = block["num_id"]
            items = []
            while i < len(blocks) and blocks[i]["kind"] == "li" and blocks[i]["tag"] == tag and blocks[i]["num_id"] == num_id:
                items.append(f"<li>{blocks[i]['html']}</li>")
                i += 1
            out.append(f"<{tag}>\n" + "\n".join(items) + f"\n</{tag}>")
            continue
        i += 1
    return "\n".join(out)


def _table_html(rows: list[list[str]]) -> str:
    if not rows:
        return ""
    parts = ["<table>"]
    for index, row in enumerate(rows):
        tag = "th" if index == 0 else "td"
        parts.append("<tr>" + "".join(f"<{tag}>{cell}</{tag}>" for cell in row) + "</tr>")
    parts.append("</table>")
    return "\n".join(parts)
