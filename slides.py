"""Turn a PowerPoint .ppt or .pptx file into HTML that convert_document can restyle."""
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
from pathlib import Path
from xml.etree import ElementTree as ET

from word import (
    CODE_FONTS,
    IMAGE_MIME,
    OLE_MAGIC,
    _core,
    _hidden_run,
    _is_code,
    _local,
    _rels,
    _table_html,
)

SLIDE_SUFFIXES = {".ppt", ".pptx", ".pptm", ".pps", ".ppsx", ".ppsm"}
PPT_CONVERT_ERROR = (
    "Old PowerPoint .ppt files need Microsoft PowerPoint or LibreOffice "
    "installed so Pack Builder can convert them. Open the file in PowerPoint, "
    "save it as .pptx, and drop that instead."
)

P = "{http://schemas.openxmlformats.org/presentationml/2006/main}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
MC = "{http://schemas.openxmlformats.org/markup-compatibility/2006}"
WEB_IMAGE = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"}
SKIP_PH = {"sldnum", "dt", "ftr", "hdr"}
TITLE_PH = {"title", "ctrtitle"}


def is_slides_name(name: str) -> bool:
    return Path(name).suffix.lower() in SLIDE_SUFFIXES


def slides_to_html(data: bytes, filename: str = "deck.pptx") -> tuple[str, dict[str, str]]:
    if not data:
        raise ValueError("PowerPoint file is empty")
    suffix = Path(filename).suffix.lower()
    if data[:2] == b"PK":
        return pptx_to_html(data, filename)
    if data[:8] == OLE_MAGIC or suffix in {".ppt", ".pps"}:
        converted = ppt_to_pptx_bytes(data, filename)
        return pptx_to_html(converted, f"{Path(filename).stem}.pptx")
    raise ValueError("That file is not a valid PowerPoint document (.ppt or .pptx)")


def ppt_to_pptx_bytes(data: bytes, filename: str = "deck.ppt") -> bytes:
    suffix = Path(filename).suffix.lower() if Path(filename).suffix else ".ppt"
    if suffix not in {".ppt", ".pps"}:
        suffix = ".ppt"
    with tempfile.TemporaryDirectory(prefix="pack-ppt-") as raw_tmp:
        tmp = Path(raw_tmp)
        source = tmp / f"source{suffix}"
        dest = tmp / "converted.pptx"
        source.write_bytes(data)
        if _powerpoint_com_to_pptx(source, dest) or _libreoffice_to_pptx(source, dest):
            converted = dest.read_bytes()
            if converted[:2] == b"PK":
                return converted
        raise ValueError(PPT_CONVERT_ERROR)


def _powerpoint_com_to_pptx(source: Path, dest: Path) -> bool:
    if os.name != "nt":
        return False
    script = dest.with_name("convert-ppt.ps1")
    script.write_text(
        "param([string]$InPath, [string]$OutPath)\n"
        "$ErrorActionPreference = 'Stop'\n"
        "$app = $null\n"
        "$pres = $null\n"
        "try {\n"
        "  $app = New-Object -ComObject PowerPoint.Application\n"
        "  $pres = $app.Presentations.Open([string]$InPath, $true, $true, $false)\n"
        "  $pres.SaveAs([string]$OutPath, 24)\n"
        "} finally {\n"
        "  if ($pres -ne $null) { $pres.Close() | Out-Null }\n"
        "  if ($app -ne $null) { $app.Quit() | Out-Null }\n"
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
            ],
            timeout=180,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0 and dest.is_file() and dest.stat().st_size > 4


def _libreoffice_to_pptx(source: Path, dest: Path) -> bool:
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
                "pptx",
                "--outdir",
                str(dest.parent),
                str(source),
            ],
            timeout=180,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    produced = source.with_suffix(".pptx")
    if produced != dest and produced.is_file():
        produced.replace(dest)
    return result.returncode == 0 and dest.is_file() and dest.stat().st_size > 4


def pptx_to_html(data: bytes, filename: str = "deck.pptx") -> tuple[str, dict[str, str]]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ValueError("That file is not a valid PowerPoint document (.ppt or .pptx)") from exc
    names = set(archive.namelist())
    if "ppt/presentation.xml" not in names:
        raise ValueError("That PowerPoint file has no presentation.xml")

    pres_rels = _rels(
        archive.read("ppt/_rels/presentation.xml.rels")
        if "ppt/_rels/presentation.xml.rels" in names
        else b""
    )
    slide_targets = _slide_targets(archive.read("ppt/presentation.xml"), pres_rels)
    core = _core(archive.read("docProps/core.xml") if "docProps/core.xml" in names else b"")
    images: dict[str, str] = {}
    slides: list[dict] = []
    for index, target in enumerate(slide_targets, start=1):
        zip_name = _ppt_path(target)
        if zip_name not in names:
            continue
        slide_xml = archive.read(zip_name)
        if _slide_hidden(slide_xml):
            continue
        rels_name = _rels_path(zip_name)
        rels = _rels(archive.read(rels_name) if rels_name in names else b"")
        _collect_images(archive, rels, images)
        notes = _notes_text(archive, names, rels)
        slides.append(_parse_slide(slide_xml, rels, images, index, notes))

    if not slides:
        raise ValueError("That PowerPoint file has no slides")

    title = core.get("title") or slides[0].get("title") or Path(filename).stem.replace("_", " ")
    html = [
        f"<!DOCTYPE html><html><head><title>{html_lib.escape(title)}</title></head><body>",
    ]
    if core.get("author") or core.get("modified"):
        meta = []
        if core.get("author"):
            meta.append(f"Created by {html_lib.escape(core['author'])}")
        if core.get("modified"):
            meta.append(f"on {html_lib.escape(core['modified'])}")
        html.append(f'<div class="page-metadata">{", ".join(meta)}</div>')
    html.append(_slides_to_html(slides, title))
    html.append("</body></html>")
    return "\n".join(html), images


def _ppt_path(target: str) -> str:
    path = target.replace("\\", "/").lstrip("/")
    if path.startswith("ppt/"):
        return path
    return "ppt/" + path.lstrip("./")


def _rels_path(zip_name: str) -> str:
    parent, name = zip_name.rsplit("/", 1)
    return f"{parent}/_rels/{name}.rels"


def _slide_targets(raw: bytes, rels: dict[str, dict[str, str]]) -> list[str]:
    root = ET.fromstring(raw)
    targets: list[str] = []
    for sld_id in root.iter(f"{P}sldId"):
        rid = sld_id.get(f"{R}id") or sld_id.get("id") or ""
        target = (rels.get(rid) or {}).get("target") or ""
        if target:
            targets.append(target)
    return targets


def _slide_hidden(raw: bytes) -> bool:
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return False
    show = root.get("show")
    return show in {"0", "false"}


def _collect_images(archive: zipfile.ZipFile, rels: dict[str, dict[str, str]], images: dict[str, str]) -> None:
    for rel in rels.values():
        if "/image" not in rel["type"].lower():
            continue
        target = rel["target"].replace("\\", "/")
        zip_name = _ppt_path(target)
        suffix = Path(target).suffix.lower()
        if suffix not in WEB_IMAGE and suffix not in IMAGE_MIME:
            continue
        try:
            blob = archive.read(zip_name)
        except KeyError:
            try:
                blob = archive.read(target.lstrip("./"))
            except KeyError:
                continue
        mime = IMAGE_MIME.get(suffix, "application/octet-stream")
        uri = f"data:{mime};base64,{base64.b64encode(blob).decode('ascii')}"
        name = Path(target).name
        images[name] = uri
        images[target] = uri
        images[zip_name] = uri
        images[f"media/{name}"] = uri


def _notes_text(archive: zipfile.ZipFile, names: set[str], rels: dict[str, dict[str, str]]) -> str:
    notes_rel = next(
        (rel for rel in rels.values() if "notesSlide" in rel["type"]),
        None,
    )
    if not notes_rel:
        return ""
    zip_name = _ppt_path(notes_rel["target"])
    if zip_name not in names:
        return ""
    try:
        root = ET.fromstring(archive.read(zip_name))
    except ET.ParseError:
        return ""
    parts: list[str] = []
    for sp in root.iter(f"{P}sp"):
        if _ph_type(sp) in SKIP_PH | TITLE_PH | {"sldimg", "slideimage"}:
            continue
        text = _plain_text(sp).strip()
        if text:
            parts.append(text)
    return "\n".join(parts).strip()


def _parse_slide(
    raw: bytes,
    rels: dict[str, dict[str, str]],
    images: dict[str, str],
    index: int,
    notes: str,
) -> dict:
    root = ET.fromstring(raw)
    tree = root.find(f".//{P}spTree")
    title = ""
    subtitle = ""
    blocks: list[dict] = []
    items = _shape_items(tree if tree is not None else root)
    items.sort(key=lambda item: (item["y"], item["x"]))
    for item in items:
        el = item["el"]
        tag = _local(el.tag)
        ph = _ph_type(el)
        if ph in SKIP_PH:
            continue
        if tag == "pic":
            for name in _image_names(el, rels, images):
                blocks.append({"kind": "img", "src": name, "alt": _pic_alt(el)})
            continue
        if tag == "graphicFrame":
            table = _table_rows(el)
            if table:
                blocks.append({"kind": "table", "rows": table})
                continue
            extra = _plain_text(el).strip()
            if extra:
                blocks.append({"kind": "p", "html": html_lib.escape(extra)})
            continue
        if ph in TITLE_PH and not title:
            title = _plain_text(el).strip()
            continue
        if ph == "subtitle" and not subtitle:
            subtitle = _plain_text(el).strip()
            continue
        blocks.extend(_shape_blocks(el, rels, images, ph))
    if not title:
        title = next((b["text"] for b in blocks if b.get("kind") == "h"), "") or f"Slide {index}"
        blocks = [b for b in blocks if not (b.get("kind") == "h" and b.get("text") == title)]
    return {"title": title, "subtitle": subtitle, "blocks": blocks, "notes": notes}


def _shape_items(tree: ET.Element) -> list[dict]:
    items: list[dict] = []

    def walk(parent: ET.Element, ox: int = 0, oy: int = 0) -> None:
        for child in _expand(parent):
            tag = _local(child.tag)
            if tag in {"nvGrpSpPr", "grpSpPr", "nvSpPr", "nvPicPr", "nvGraphicFramePr"}:
                continue
            if tag == "grpSp":
                x, y = _origin(child)
                walk(child, ox + x, oy + y)
                continue
            if tag in {"sp", "pic", "graphicFrame", "cxnSp"}:
                x, y = _origin(child)
                items.append({"el": child, "x": ox + x, "y": oy + y})

    walk(tree)
    return items


def _expand(parent: ET.Element) -> list[ET.Element]:
    out: list[ET.Element] = []
    for child in parent:
        if child.tag == f"{MC}AlternateContent":
            choice = child.find(f"{MC}Choice")
            fallback = child.find(f"{MC}Fallback")
            out.extend(list(choice if choice is not None else fallback or child))
        else:
            out.append(child)
    return out


def _origin(el: ET.Element) -> tuple[int, int]:
    candidates = [el, *list(el)]
    for node in candidates:
        xfrm = None
        if _local(node.tag) == "xfrm":
            xfrm = node
        elif _local(node.tag) in {"spPr", "grpSpPr"}:
            xfrm = node.find(f"{A}xfrm")
        if xfrm is None:
            continue
        off = xfrm.find(f"{A}off")
        if off is not None:
            return int(off.get("x") or 0), int(off.get("y") or 0)
    return 0, 0


def _ph_type(el: ET.Element) -> str:
    for node in el.iter(f"{P}ph"):
        return (node.get("type") or "body").lower()
    return ""


def _pic_alt(el: ET.Element) -> str:
    for node in el.iter():
        if _local(node.tag) == "cNvPr":
            return (node.get("descr") or node.get("name") or "").strip()
    return ""


def _image_names(el: ET.Element, rels: dict[str, dict[str, str]], images: dict[str, str]) -> list[str]:
    names: list[str] = []
    for node in el.iter():
        if not node.tag.endswith("}blip"):
            continue
        rid = node.get(f"{R}embed") or node.get(f"{R}link") or ""
        target = (rels.get(rid) or {}).get("target") or ""
        name = Path(target).name
        if name and name in images:
            names.append(name)
        elif name:
            names.append(name)
    return names


def _plain_text(el: ET.Element | None) -> str:
    if el is None:
        return ""
    parts: list[str] = []
    for node in el.iter():
        if node.tag == f"{A}t" and node.text:
            parts.append(node.text)
        elif node.tag == f"{A}tab":
            parts.append("\t")
        elif node.tag == f"{A}br":
            parts.append("\n")
        elif node.tag == f"{A}p" and parts and not parts[-1].endswith("\n"):
            parts.append("\n")
    return re.sub(r"\n+", "\n", "".join(parts)).strip()


def _shape_blocks(
    el: ET.Element,
    rels: dict[str, dict[str, str]],
    images: dict[str, str],
    ph: str = "",
) -> list[dict]:
    blocks: list[dict] = []
    for name in _image_names(el, rels, images):
        blocks.append({"kind": "img", "src": name, "alt": _pic_alt(el)})
    tx = el.find(f".//{A}txBody")
    if tx is None:
        tx = el.find(f".//{P}txBody")
    if tx is None:
        return blocks
    paras = [_paragraph(p, rels) for p in tx.findall(f"{A}p")]
    paras = [p for p in paras if p["text"].strip()]
    if not paras:
        return blocks
    joined = "\n".join(p["text"] for p in paras)
    fonts = set().union(*(p["fonts"] for p in paras))
    if _is_code("", fonts, joined):
        blocks.append({"kind": "code", "text": joined})
        return blocks
    default_list = ph in {"body", "obj"} and (
        len(paras) > 1 or any(para["lvl"] or para["bullet"] or para["numbered"] for para in paras)
    )
    for para in paras:
        if para["bullet"] or para["numbered"] or default_list:
            blocks.append(
                {
                    "kind": "li",
                    "tag": "ol" if para["numbered"] else "ul",
                    "html": para["html"],
                }
            )
        else:
            blocks.append({"kind": "p", "html": para["html"]})
    return blocks


def _paragraph(p: ET.Element, rels: dict[str, dict[str, str]]) -> dict:
    ppr = p.find(f"{A}pPr")
    lvl = 0
    bullet = False
    numbered = False
    if ppr is not None:
        lvl = int(ppr.get("lvl") or 0)
        if ppr.find(f"{A}buNone") is None:
            if ppr.find(f"{A}buAutoNum") is not None:
                numbered = True
            elif ppr.find(f"{A}buChar") is not None or ppr.find(f"{A}buFont") is not None or ppr.find(f"{A}buBlip") is not None:
                bullet = True
    html, text, fonts = _inline(p, rels)
    if lvl and not bullet and not numbered:
        bullet = True
    return {"html": html, "text": text, "fonts": fonts, "bullet": bullet, "numbered": numbered, "lvl": lvl}


def _inline(p: ET.Element, rels: dict[str, dict[str, str]]) -> tuple[str, str, set[str]]:
    parts: list[str] = []
    text_parts: list[str] = []
    fonts: set[str] = set()

    def take_text(node: ET.Element) -> str:
        bits: list[str] = []
        if node.tag == f"{A}t" and node.text:
            bits.append(node.text)
        for child in node:
            if child.tag == f"{A}t" and child.text:
                bits.append(child.text)
            elif child.tag == f"{A}tab":
                bits.append(" ")
            elif child.tag == f"{A}br":
                bits.append("\n")
        return "".join(bits)

    for child in p:
        tag = _local(child.tag)
        if tag == "r":
            raw = take_text(child)
            rpr = child.find(f"{A}rPr")
            piece = html_lib.escape(raw).replace("\n", "<br>")
            if rpr is not None:
                if rpr.get("b") in {"1", "true"}:
                    piece = f"<strong>{piece}</strong>"
                if rpr.get("i") in {"1", "true"}:
                    piece = f"<em>{piece}</em>"
                if rpr.get("u") and rpr.get("u") not in {"none", "0"}:
                    piece = f"<u>{piece}</u>"
                latin = rpr.find(f"{A}latin")
                if latin is not None and latin.get("typeface"):
                    fonts.add(latin.get("typeface", "").lower())
                if fonts & CODE_FONTS:
                    piece = f"<code>{piece}</code>"
                href = _run_href(rpr, rels)
                if href:
                    piece = f'<a href="{html_lib.escape(href, quote=True)}">{piece}</a>'
            parts.append(piece)
            text_parts.append(raw)
        elif tag == "br":
            parts.append("<br>")
            text_parts.append("\n")
        elif tag == "fld":
            raw = take_text(child)
            parts.append(html_lib.escape(raw))
            text_parts.append(raw)
    return "".join(parts).strip(), "".join(text_parts).strip(), fonts


def _run_href(rpr: ET.Element, rels: dict[str, dict[str, str]]) -> str:
    click = rpr.find(f"{A}hlinkClick")
    if click is None:
        return ""
    rid = click.get(f"{R}id") or ""
    href = (rels.get(rid) or {}).get("target") or click.get("tooltip") or ""
    if href.startswith("http") or href.startswith("mailto:"):
        return href
    return ""


def _table_rows(el: ET.Element) -> list[list[str]]:
    tbl = el.find(f".//{A}tbl")
    if tbl is None:
        return []
    rows: list[list[str]] = []
    for tr in tbl.findall(f"{A}tr"):
        cells = []
        for tc in tr.findall(f"{A}tc"):
            paras = []
            for p in tc.findall(f".//{A}p"):
                html, text, _fonts = _inline(p, {})
                inner = html or html_lib.escape(text)
                if inner:
                    paras.append(inner)
            cells.append("<br>".join(paras))
        if any(cell.strip() for cell in cells):
            rows.append(cells)
    return rows


def _slides_to_html(slides: list[dict], deck_title: str) -> str:
    out: list[str] = []
    for index, slide in enumerate(slides, start=1):
        title = slide["title"].strip() or f"Slide {index}"
        if index == 1 and title.strip() == deck_title.strip() and not slide["blocks"] and not slide["notes"]:
            continue
        out.append(f"<h2>{html_lib.escape(title)}</h2>")
        if slide.get("subtitle"):
            out.append(f"<p><em>{html_lib.escape(slide['subtitle'])}</em></p>")
        out.append(_blocks_to_html(slide["blocks"]))
        if slide.get("notes"):
            note_html = "<br>".join(html_lib.escape(line) for line in slide["notes"].splitlines() if line.strip())
            out.append(f"<blockquote><p>{note_html}</p></blockquote>")
    return "\n".join(part for part in out if part)


def _blocks_to_html(blocks: list[dict]) -> str:
    out: list[str] = []
    i = 0
    while i < len(blocks):
        block = blocks[i]
        kind = block["kind"]
        if kind == "p":
            out.append(f"<p>{block['html']}</p>")
            i += 1
            continue
        if kind == "code":
            out.append(f"<pre><code>{html_lib.escape(block['text'])}</code></pre>")
            i += 1
            continue
        if kind == "img":
            alt = html_lib.escape(block.get("alt") or "", quote=True)
            out.append(f'<img src="{html_lib.escape(block["src"], quote=True)}" alt="{alt}">')
            i += 1
            continue
        if kind == "table":
            out.append(_table_html(block["rows"]))
            i += 1
            continue
        if kind == "h":
            out.append(f"<h3>{html_lib.escape(block['text'])}</h3>")
            i += 1
            continue
        if kind == "li":
            tag = block["tag"]
            items = []
            while i < len(blocks) and blocks[i]["kind"] == "li" and blocks[i]["tag"] == tag:
                items.append(f"<li>{blocks[i]['html']}</li>")
                i += 1
            out.append(f"<{tag}>\n" + "\n".join(items) + f"\n</{tag}>")
            continue
        i += 1
    return "\n".join(out)
