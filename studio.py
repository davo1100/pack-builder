"""Pack builder: drop HTML specs, edit, download one client file."""
from __future__ import annotations

import base64
import json
import os
import posixpath
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from merge import ROOT, build_from_payload, ingest_upload, load_client_css, docs_from_payload, settings_from_payload, sync_overview
from slides import is_slides_name
from word import is_word_name

SAFE_FOLDERS = ("source", "inbox")
PUBLIC_FILES = {"/studio.html", "/favicon.ico"}
PUBLIC_PREFIXES = ("/css/", "/js/", "/data/", "/assets/")


def hosted() -> bool:
    return bool(os.environ.get("RENDER") or os.environ.get("PACK_BUILDER_HOSTED"))


def bind_host() -> str:
    if hosted() or os.environ.get("PORT"):
        return "0.0.0.0"
    return "127.0.0.1"


def bind_port() -> int:
    return int(os.environ.get("PORT", "8787"))


def public_url(host: str, port: int) -> str:
    if hosted():
        return os.environ.get("RENDER_EXTERNAL_URL") or f"http://{host}:{port}/studio.html"
    return f"http://127.0.0.1:{port}/studio.html"


def is_public_path(path: str) -> bool:
    normalized = posixpath.normpath(unquote(path or "/"))
    if not normalized.startswith("/"):
        normalized = "/" + normalized
    if normalized == "/..":
        return False
    parts = Path(normalized).parts
    if ".." in parts:
        return False
    if normalized in PUBLIC_FILES:
        return True
    return any(normalized.startswith(prefix) for prefix in PUBLIC_PREFIXES)


class StudioHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format: str, *args) -> None:
        print(f"[studio] {self.address_string()} {format % args}", flush=True)

    def handle(self) -> None:
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            # Client closed the tab / timed out mid-response.
            pass

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path or "/"
        if path == "/":
            self.path = "/studio.html"
            path = "/studio.html"

        if path == "/api/config":
            return self._send_json({"hosted": hosted()})

        if path == "/api/local-files":
            if hosted():
                return self._send_json({"error": "Local import is not available on the hosted app"}, 404)
            return self._send_json(_list_local_files())

        if path == "/api/local-file":
            if hosted():
                return self._send_json({"error": "Local import is not available on the hosted app"}, 404)
            query = parse_qs(parsed.query)
            folder = (query.get("folder") or [""])[0]
            name = (query.get("name") or [""])[0]
            try:
                payload = _read_local_file(folder, name)
            except FileNotFoundError:
                return self._send_json({"error": "File not found"}, 404)
            except ValueError as exc:
                return self._send_json({"error": str(exc)}, 400)
            return self._send_json(payload)

        if not is_public_path(path):
            self.send_error(404)
            return
        return super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        if length > 80_000_000:
            return self._send_json({"error": "Payload too large"}, 413)
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return self._send_json({"error": "Invalid JSON"}, 400)

        if parsed.path == "/api/ingest":
            try:
                images = data.get("images") or {}
                asset_dir = None if hosted() else (data.get("asset_dir") or None)
                docs = []
                settings = None
                for item in data.get("files") or []:
                    name = item.get("filename") or "document.html"
                    item_dir = None if hosted() else (item.get("asset_dir") or asset_dir)
                    if (
                        is_word_name(name)
                        or is_slides_name(name)
                        or item.get("docx")
                        or item.get("doc")
                        or item.get("pptx")
                        or item.get("ppt")
                    ):
                        raw_b64 = (
                            item.get("docx")
                            or item.get("doc")
                            or item.get("pptx")
                            or item.get("ppt")
                            or ""
                        )
                        binary = base64.b64decode(raw_b64) if raw_b64 else b""
                        batch, pack_settings = ingest_upload(
                            name,
                            data=binary,
                            asset_dir=item_dir,
                            images=images,
                        )
                    else:
                        batch, pack_settings = ingest_upload(
                            name,
                            raw=item.get("html") or "",
                            asset_dir=item_dir,
                            images=images,
                        )
                    docs.extend(_doc_to_payload(doc) for doc in batch)
                    if pack_settings:
                        settings = pack_settings
                models = docs_from_payload({"docs": docs})
                overview, created = sync_overview(models, settings_from_payload({"settings": settings or {}}))
                if created:
                    models.insert(0, overview)
                docs = [_doc_to_payload(doc) for doc in models]
            except Exception as exc:
                return self._send_json({"error": str(exc)}, 400)
            payload = {"docs": docs, "overview_synced": True}
            if settings:
                payload["settings"] = settings
            return self._send_json(payload)

        if parsed.path == "/api/sync-overview":
            try:
                overview, created = sync_overview(
                    docs_from_payload(data),
                    settings_from_payload(data),
                )
            except Exception as exc:
                return self._send_json({"error": str(exc)}, 400)
            payload = _doc_to_payload(overview)
            payload["created"] = created
            return self._send_json(payload)

        if parsed.path == "/api/build":
            try:
                html = build_from_payload(data, load_client_css())
            except Exception as exc:
                return self._send_json({"error": str(exc)}, 400)
            filename = (
                ((data.get("settings") or {}).get("output_filename"))
                or "documentation.html"
            )
            return self._send_json({"html": html, "filename": filename})

        self.send_error(404)

    def _send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            # Browser aborted (often the 25s client timeout on a large /api/build).
            return


class QuietThreadingHTTPServer(ThreadingHTTPServer):
    """Don't dump full tracebacks for routine client disconnects."""

    def handle_error(self, request, client_address) -> None:
        import sys

        exc = sys.exc_info()[1]
        if isinstance(exc, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)):
            host = client_address[0] if client_address else "?"
            print(f"[studio] {host} disconnected before the response finished", flush=True)
            return
        super().handle_error(request, client_address)


def _list_local_files() -> dict:
    files = []
    for folder in SAFE_FOLDERS:
        directory = ROOT / folder
        if not directory.is_dir():
            continue
        for path in sorted(directory.iterdir()):
            if path.is_file() and path.suffix.lower() in {
                ".html",
                ".doc",
                ".docx",
                ".ppt",
                ".pptx",
                ".pptm",
                ".pps",
                ".ppsx",
                ".ppsm",
            }:
                files.append({"folder": folder, "name": path.name})
    return {"files": files}


def _doc_to_payload(doc) -> dict:
    return {
        "filename": doc.filename,
        "title": doc.title,
        "role": doc.role,
        "draft": doc.draft,
        "num": doc.num,
        "body": doc.body,
        "include": doc.include,
    }


def _read_local_file(folder: str, name: str) -> dict:
    if folder not in SAFE_FOLDERS:
        raise ValueError("Folder is not allowed")
    if not name or Path(name).name != name or "/" in name or "\\" in name:
        raise ValueError("Invalid file name")
    path = ROOT / folder / name
    if not path.is_file():
        raise FileNotFoundError
    if is_word_name(name) or is_slides_name(name):
        batch, settings = ingest_upload(name, data=path.read_bytes(), asset_dir=path.parent)
    else:
        batch, settings = ingest_upload(
            name,
            raw=path.read_text(encoding="utf-8"),
            asset_dir=path.parent,
        )
    docs = [_doc_to_payload(doc) for doc in batch]
    if settings or len(docs) != 1:
        payload = {"docs": docs}
        if settings:
            payload["settings"] = settings
        return payload
    return docs[0]


def main() -> None:
    host = bind_host()
    port = bind_port()
    if not hosted():
        (ROOT / "inbox").mkdir(exist_ok=True)
    url = public_url(host, port)
    try:
        server = QuietThreadingHTTPServer((host, port), StudioHandler)
    except OSError as exc:
        print(f"Could not start on {url}", flush=True)
        print(str(exc), flush=True)
        if not hosted():
            print("If another Pack Builder window is already open, use that one or close it first.", flush=True)
            try:
                webbrowser.open(url)
            except Exception:
                pass
        raise SystemExit(1) from exc
    print(f"Pack builder running at {url}", flush=True)
    if hosted():
        print("Hosted mode: drop files in the browser. Uploads are processed in memory and not saved.", flush=True)
    else:
        print("Drop HTML, Word, or PowerPoint files in the browser, or put them in inbox/ or source/ and import.", flush=True)
        print("Press Ctrl+C to stop.", flush=True)
        try:
            webbrowser.open(url)
        except Exception:
            print(f"Open this address in your browser: {url}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.server_close()


if __name__ == "__main__":
    main()
