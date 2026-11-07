"""Test-only observation of real flows; never synthesizes flow or stream IDs."""

import base64
import hashlib
import json
from pathlib import Path

from mitmproxy import ctx


def bytes_view(value):
    if value is None:
        return None
    return {"base64": base64.b64encode(value).decode("ascii"),
            "bytes": len(value), "sha256": hashlib.sha256(value).hexdigest()}


class Observer:
    def load(self, loader):
        loader.add_option("rea_lab_log", str, "", "HTTP/3 verifier observations")

    def emit(self, event, **data):
        with Path(ctx.options.rea_lab_log).open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"event": event, **data}) + "\n")

    def running(self):
        self.emit("ready")

    def connection(self, conn):
        return {"id": conn.id, "transport_protocol": conn.transport_protocol,
                "alpn": bytes_view(conn.alpn), "tls_version": conn.tls_version,
                "timestamp_tls_setup": conn.timestamp_tls_setup,
                "error": conn.error}

    def tls_established_client(self, data):
        self.emit("tls-established-client", connection=self.connection(data.conn))

    def tls_established_server(self, data):
        self.emit("tls-established-server", connection=self.connection(data.conn))

    def flow(self, event, flow):
        def message(message):
            if message is None:
                return None
            return {"http_version": message.http_version,
                    "content": bytes_view(message.raw_content),
                    "timestamp_end": message.timestamp_end}
        self.emit(event, id=flow.id, case=flow.request.headers.get("x-lab-case", "curl"),
                  request=message(flow.request), response=message(flow.response),
                  error=None if flow.error is None else flow.error.msg,
                  client_conn=self.connection(flow.client_conn),
                  server_conn=self.connection(flow.server_conn))

    def request(self, flow):
        self.flow("request", flow)

    def response(self, flow):
        self.flow("response", flow)

    def error(self, flow):
        self.flow("error", flow)


addons = [Observer()]
