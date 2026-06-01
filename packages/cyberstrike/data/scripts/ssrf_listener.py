#!/usr/bin/env python3
"""SSRF callback listener — lightweight HTTP server that logs all incoming requests as evidence."""
import argparse
import json
import datetime
import threading
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler

HITS = []
LOCK = threading.Lock()

class SSRFHandler(BaseHTTPRequestHandler):
    def _handle(self, method):
        body = ""
        content_length = self.headers.get("Content-Length")
        if content_length:
            body = self.rfile.read(int(content_length)).decode("utf-8", errors="replace")

        hit = {
            "time": datetime.datetime.now().isoformat(),
            "method": method,
            "path": self.path,
            "headers": dict(self.headers),
            "body": body[:1000] if body else "",
            "client_ip": self.client_address[0],
            "client_port": self.client_address[1],
        }

        with LOCK:
            HITS.append(hit)

        print(f"[{hit['time']}] {method} {self.path} from {hit['client_ip']}")
        if body:
            print(f"  Body: {body[:200]}")
        print(f"  Headers: {json.dumps(dict(self.headers), indent=4)}")
        print()

        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ok")

    def do_GET(self): self._handle("GET")
    def do_POST(self): self._handle("POST")
    def do_PUT(self): self._handle("PUT")
    def do_DELETE(self): self._handle("DELETE")
    def do_OPTIONS(self): self._handle("OPTIONS")
    def do_HEAD(self): self._handle("HEAD")
    def do_PATCH(self): self._handle("PATCH")

    def log_message(self, *args):
        pass  # Suppress default logging

def main():
    parser = argparse.ArgumentParser(description="SSRF callback listener")
    parser.add_argument("-p", "--port", type=int, default=8888, help="Listen port (default: 8888)")
    parser.add_argument("-o", "--output", default=None, help="Save hits to JSON file on exit")
    parser.add_argument("--timeout", type=int, default=0, help="Auto-stop after N seconds (0=forever)")
    args = parser.parse_args()

    server = HTTPServer(("0.0.0.0", args.port), SSRFHandler)
    print(f"SSRF listener started on port {args.port}")
    print(f"Send SSRF payloads pointing to http://YOUR_IP:{args.port}/test")
    print(f"Press Ctrl+C to stop\n")

    try:
        if args.timeout > 0:
            timer = threading.Timer(args.timeout, lambda: server.shutdown())
            timer.daemon = True
            timer.start()
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print(f"\n{'='*60}")
        print(f"Total hits received: {len(HITS)}")
        if HITS and args.output:
            with open(args.output, "w") as f:
                json.dump(HITS, f, indent=2)
            print(f"Hits saved to: {args.output}")
        elif HITS:
            print(json.dumps(HITS, indent=2))

if __name__ == "__main__":
    main()
