"""Start the pack builder server for real and exercise its core endpoints.

Run before every push (see .github/workflows/ci.yml): this would have caught
the fb1d52e IndentationError that silently broke every deploy, because it
actually imports and boots studio.py instead of just checking syntax.
"""
from __future__ import annotations

import base64
import io
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = "8799"
BASE = f"http://127.0.0.1:{PORT}"


def wait_for_server(proc: subprocess.Popen, timeout: float = 15.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"Server exited early with code {proc.returncode}")
        try:
            urllib.request.urlopen(f"{BASE}/api/config", timeout=1)
            return
        except (urllib.error.URLError, ConnectionError):
            time.sleep(0.3)
    raise RuntimeError("Server did not start in time")


def get(path: str) -> tuple[int, dict]:
    with urllib.request.urlopen(f"{BASE}{path}", timeout=15) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def post(path: str, payload: dict) -> tuple[int, dict]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE}{path}", data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def main() -> int:
    env = dict(os.environ)
    env["PACK_BUILDER_HOSTED"] = "1"
    env["PORT"] = PORT
    proc = subprocess.Popen(
        [sys.executable, "studio.py"],
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        wait_for_server(proc)

        status, config = get("/api/config")
        assert status == 200 and config.get("hosted") is True, f"unexpected /api/config: {config}"

        sample_html = """
        <html><body>
        <h1>Sample Doc</h1>
        <p>Hello &amp; world</p>
        <pre><code>print("hi")</code></pre>
        </body></html>
        """
        status, ingested = post("/api/ingest", {"files": [{"filename": "sample.html", "html": sample_html}]})
        assert status == 200, f"/api/ingest failed: {ingested}"
        docs = ingested["docs"]
        assert docs, "ingest produced no docs"

        status, built = post(
            "/api/build",
            {
                "docs": docs,
                "settings": {
                    "output_filename": "smoke.html",
                    "footer": "Sample Co &bull; Confidential",
                    "theme": {"content_max_width": "900px"},
                },
            },
        )
        assert status == 200, f"/api/build failed: {built}"
        html = built["html"]
        assert "Sample Co &bull; Confidential" in html, "footer setting missing from build"
        assert "900px" in html, "theme content_max_width was not applied"
        assert "<h1>Sample Doc</h1>" in html or "Sample Doc" in html, "ingested content missing from build"

        try:
            from PIL import Image

            # Oversized (clears both the resize threshold and the
            # compressor's minimum-size floor) with a couple of noisy
            # patches so PNG's own compression doesn't already shrink it to
            # nothing - otherwise this wouldn't actually exercise resizing.
            w, h = 2200, 1900
            img = Image.new("RGB", (w, h), (120, 140, 160))
            noise = Image.effect_noise((300, 300), 50).convert("RGB")
            img.paste(noise, (0, 0))
            img.paste(noise, (w - 300, h - 300))
            img_buf = io.BytesIO()
            img.save(img_buf, format="PNG")
            raw_png = img_buf.getvalue()
            data_uri = "data:image/png;base64," + base64.b64encode(raw_png).decode("ascii")
            html_with_image = f'<html><body><h1>Doc</h1><img src="{data_uri}"></body></html>'
            status, ingested_img = post(
                "/api/ingest", {"files": [{"filename": "with-image.html", "html": html_with_image}]}
            )
            assert status == 200, f"/api/ingest with image failed: {ingested_img}"
            bodies = [d["body"] for d in ingested_img["docs"] if "base64," in d["body"]]
            assert bodies, "embedded image did not survive ingest"
            compressed_b64 = bodies[0].split("base64,", 1)[1].split('"', 1)[0]
            compressed_bytes = base64.b64decode(compressed_b64)
            assert len(compressed_bytes) < len(raw_png), (
                f"oversized embedded image was not shrunk ({len(compressed_bytes)} >= {len(raw_png)})"
            )
        except ImportError:
            print("Pillow not installed - skipping image compression check.")

        print("Smoke test passed.")
        return 0
    finally:
        proc.terminate()
        try:
            out, _ = proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            out, _ = proc.communicate()
        if proc.returncode not in (0, None) and proc.returncode != -15:
            print(out)


if __name__ == "__main__":
    raise SystemExit(main())
