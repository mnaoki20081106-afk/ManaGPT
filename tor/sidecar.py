#!/usr/bin/env python3
"""Read-only Tor onion research sidecar. Bind to loopback; never expose publicly."""
import hmac
import http.server
import json
import os
import re
import subprocess
import urllib.parse

ONION_V3 = re.compile(r"^[a-z2-7]{56}\.onion$")
TOKEN = os.environ.get("TOR_RESEARCH_TOKEN", "")
HOST = os.environ.get("TOR_RESEARCH_BIND", "127.0.0.1")
PORT = int(os.environ.get("TOR_RESEARCH_PORT", "8765"))
PROXY = os.environ.get("TOR_SOCKS_PROXY", "127.0.0.1:9050")
MAX_BODY = 120_000

def validate_url(value):
    if not isinstance(value, str) or len(value) > 2000:
        raise ValueError("Invalid URL")
    u = urllib.parse.urlsplit(value)
    if u.scheme not in ("http", "https") or not ONION_V3.fullmatch(u.hostname or ""):
        raise ValueError("Only Tor v3 onion URLs are supported")
    if u.username or u.password or u.port or u.fragment:
        raise ValueError("Credentials, ports and fragments are forbidden")
    if u.path.startswith("//") or "\\" in value or any(ord(c) < 32 for c in value):
        raise ValueError("Unsafe URL")
    return value

def fetch_onion(url):
    validate_url(url)
    cmd = [
        "curl", "--silent", "--show-error", "--fail",
        "--socks5-hostname", PROXY, "--noproxy", "",
        "--proto", "=http,https", "--max-time", "20", "--connect-timeout", "10",
        "--max-filesize", str(MAX_BODY), "--max-redirs", "0",
        "--request", "GET", "--header", "Accept: text/html",
        "--header", "User-Agent: manaGPT-onion-research/1.0",
        "--output", "-", "--write-out", "\\n%{http_code} %{content_type}",
        url,
    ]
    # No shell, no environment credentials forwarded to curl.
    result = subprocess.run(cmd, capture_output=True, timeout=25, check=False, env={"PATH": "/usr/bin:/bin"})
    if result.returncode:
        raise RuntimeError("Tor fetch failed")
    body, marker, metadata = result.stdout.rpartition(b"\n")
    if not marker or len(body) > MAX_BODY:
        raise RuntimeError("Invalid or oversized response")
    parts = metadata.decode("ascii", "replace").split(" ", 1)
    if len(parts) != 2 or parts[0] != "200" or not parts[1].lower().startswith("text/html"):
        raise RuntimeError("Only HTTP 200 HTML pages are supported")
    return body.decode("utf-8", "replace")

class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/fetch":
            return self.reply(404, {"error": "Not found"})
        supplied = self.headers.get("Authorization", "")
        if not TOKEN or not hmac.compare_digest(supplied, "Bearer " + TOKEN):
            return self.reply(401, {"error": "Unauthorized"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 2500:
                raise ValueError("Invalid request size")
            body = json.loads(self.rfile.read(size))
            page = fetch_onion(body.get("url"))
            return self.reply(200, {"text": re.sub(r"<[^>]*>", " ", page)[:12000], "verified": False})
        except (ValueError, json.JSONDecodeError):
            return self.reply(400, {"error": "Invalid request"})
        except Exception:
            return self.reply(502, {"error": "Tor retrieval failed"})

    def reply(self, status, data):
        payload = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_):
        pass  # Avoid storing sensitive onion URLs in request logs.

if __name__ == "__main__":
    if not TOKEN or len(TOKEN) < 32:
        raise SystemExit("Set a random TOR_RESEARCH_TOKEN of at least 32 characters")
    http.server.HTTPServer((HOST, PORT), Handler).serve_forever()
