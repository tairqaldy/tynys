"""The HTTP layer shared by the Vercel functions (api/*.py) and the local dev server."""

import json
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlsplit

from tynys import service


class ApiHandler(BaseHTTPRequestHandler):
    """GET /api/<endpoint>?... -> JSON. Subclasses set `endpoint`, or leave it None to take it from the path."""

    endpoint = None

    def endpoint_name(self, path):
        if self.endpoint:
            return self.endpoint
        parts = [p for p in path.split("/") if p]
        if len(parts) == 2 and parts[0] == "api":
            return parts[1].removesuffix(".py")
        return ""

    def respond(self, with_body):
        """Run the endpoint and send the JSON answer; HEAD sends the same headers without the body."""
        url = urlsplit(self.path)
        params = {k: v[0] for k, v in parse_qs(url.query).items()}
        status, payload, cache_control = service.handle(self.endpoint_name(url.path), params)
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache_control)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        if with_body:
            self.wfile.write(body)

    def do_GET(self):
        self.respond(with_body=True)

    def do_HEAD(self):
        self.respond(with_body=False)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.send_header("Content-Length", "0")
        self.end_headers()
