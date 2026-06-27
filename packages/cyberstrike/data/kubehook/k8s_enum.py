#!/usr/bin/env python3
"""
k8s_enum.py — Kubernetes Cluster Enumeration

Enumerates namespaces, pods, services, secrets (metadata only), RBAC roles/bindings,
ingresses, service accounts, and nodes across the cluster. Provides a comprehensive
snapshot of the Kubernetes environment for offensive reconnaissance.

Part of CyberStrike offensive security platform.
"""

import argparse
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


class K8sEnumerator:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.v1 = None
        self.rbac_v1 = None
        self.networking_v1 = None

    def signal_handler(self, signum, frame):
        self.running = False

    def print_banner(self):
        print("=" * 70)
        print("CyberStrike — Kubernetes Cluster Enumeration")
        print("=" * 70)
        print(f"PID:        {os.getpid()}")
        print(f"Namespace:  {self.args.namespace or 'all'}")
        print(f"Output:     {'JSON' if self.args.json_output else 'text'}")
        print(f"Started:    {datetime.now().isoformat()}")
        print("=" * 70)
        print()

    def emit(self, record):
        self.event_count += 1
        if self.args.json_output:
            print(json.dumps(record), flush=True)
        else:
            category = record.get("type", "unknown")
            count = record.get("count", 0)
            print(f"\n--- {category} ({count} found) ---", flush=True)
            for item in record.get("items", []):
                if category == "namespaces":
                    print(f"  {item['name']:<40} status={item.get('status', 'N/A')}", flush=True)
                elif category == "pods":
                    print(f"  {item['namespace']}/{item['name']:<50} status={item.get('status', 'N/A'):<12} "
                          f"node={item.get('node', 'N/A'):<20} ip={item.get('ip', 'N/A')}", flush=True)
                    for c in item.get("containers", []):
                        print(f"    container: {c}", flush=True)
                    if item.get("service_account"):
                        print(f"    sa: {item['service_account']}", flush=True)
                elif category == "services":
                    ports_str = ", ".join(str(p) for p in item.get("ports", []))
                    print(f"  {item['namespace']}/{item['name']:<50} type={item.get('service_type', 'N/A'):<15} "
                          f"cluster_ip={item.get('cluster_ip', 'N/A'):<16} external={item.get('external_ip', 'N/A')}", flush=True)
                    if ports_str:
                        print(f"    ports: {ports_str}", flush=True)
                elif category == "secrets":
                    print(f"  {item['namespace']}/{item['name']:<50} type={item.get('secret_type', 'N/A'):<40} "
                          f"keys={item.get('num_keys', 0)}", flush=True)
                elif category in ("cluster_roles", "cluster_role_bindings", "roles", "role_bindings"):
                    print(f"  {item.get('namespace', 'cluster')}/{item['name']}", flush=True)
                    if item.get("rules"):
                        for rule in item["rules"][:3]:
                            print(f"    rule: {rule}", flush=True)
                    if item.get("subjects"):
                        for subj in item["subjects"][:3]:
                            print(f"    subject: {subj}", flush=True)
                elif category == "ingresses":
                    print(f"  {item['namespace']}/{item['name']}", flush=True)
                    for rule in item.get("rules", []):
                        print(f"    host={rule.get('host', '*')}", flush=True)
                        for path in rule.get("paths", []):
                            print(f"      {path.get('path', '/'):<30} -> {path.get('backend', 'N/A')}", flush=True)
                elif category == "service_accounts":
                    secrets_count = item.get("secrets_count", 0)
                    print(f"  {item['namespace']}/{item['name']:<50} secrets={secrets_count}", flush=True)
                elif category == "nodes":
                    print(f"  {item['name']:<40} status={item.get('status', 'N/A'):<10} "
                          f"roles={item.get('roles', 'N/A'):<20} kubelet={item.get('kubelet_version', 'N/A')}", flush=True)

    def enum_namespaces(self):
        if not self.running:
            return
        try:
            result = self.v1.list_namespace()
            items = []
            for ns in result.items:
                items.append({
                    "name": ns.metadata.name,
                    "status": ns.status.phase if ns.status else "Unknown",
                    "labels": dict(ns.metadata.labels) if ns.metadata.labels else {},
                    "created": ns.metadata.creation_timestamp.isoformat() if ns.metadata.creation_timestamp else None,
                })
            self.emit({"type": "namespaces", "count": len(items), "items": items})
        except ApiException as e:
            self.emit({"type": "namespaces", "count": 0, "items": [], "error": str(e.reason)})

    def enum_pods(self):
        if not self.running:
            return
        try:
            if self.args.namespace:
                result = self.v1.list_namespaced_pod(namespace=self.args.namespace)
            else:
                result = self.v1.list_pod_for_all_namespaces()
            items = []
            for pod in result.items:
                containers = []
                if pod.spec and pod.spec.containers:
                    containers = [c.name for c in pod.spec.containers]
                items.append({
                    "name": pod.metadata.name,
                    "namespace": pod.metadata.namespace,
                    "status": pod.status.phase if pod.status else "Unknown",
                    "containers": containers,
                    "node": pod.spec.node_name if pod.spec else None,
                    "ip": pod.status.pod_ip if pod.status else None,
                    "service_account": pod.spec.service_account_name if pod.spec else None,
                    "host_network": pod.spec.host_network if pod.spec else False,
                    "host_pid": pod.spec.host_pid if pod.spec else False,
                })
            self.emit({"type": "pods", "count": len(items), "items": items})
        except ApiException as e:
            self.emit({"type": "pods", "count": 0, "items": [], "error": str(e.reason)})

    def enum_services(self):
        if not self.running:
            return
        try:
            if self.args.namespace:
                result = self.v1.list_namespaced_service(namespace=self.args.namespace)
            else:
                result = self.v1.list_service_for_all_namespaces()
            items = []
            for svc in result.items:
                ports = []
                if svc.spec and svc.spec.ports:
                    for p in svc.spec.ports:
                        ports.append({
                            "name": p.name,
                            "port": p.port,
                            "target_port": str(p.target_port) if p.target_port else None,
                            "protocol": p.protocol,
                            "node_port": p.node_port,
                        })
                external_ips = []
                if svc.spec and svc.spec.external_i_ps:
                    external_ips = svc.spec.external_i_ps
                if svc.status and svc.status.load_balancer and svc.status.load_balancer.ingress:
                    for ing in svc.status.load_balancer.ingress:
                        if ing.ip:
                            external_ips.append(ing.ip)
                        if ing.hostname:
                            external_ips.append(ing.hostname)
                items.append({
                    "name": svc.metadata.name,
                    "namespace": svc.metadata.namespace,
                    "service_type": svc.spec.type if svc.spec else None,
                    "cluster_ip": svc.spec.cluster_ip if svc.spec else None,
                    "external_ip": ", ".join(external_ips) if external_ips else None,
                    "ports": ports,
                })
            self.emit({"type": "services", "count": len(items), "items": items})
        except ApiException as e:
            self.emit({"type": "services", "count": 0, "items": [], "error": str(e.reason)})

    def enum_secrets(self):
        if not self.running:
            return
        try:
            if self.args.namespace:
                result = self.v1.list_namespaced_secret(namespace=self.args.namespace)
            else:
                result = self.v1.list_secret_for_all_namespaces()
            items = []
            for secret in result.items:
                num_keys = len(secret.data) if secret.data else 0
                items.append({
                    "name": secret.metadata.name,
                    "namespace": secret.metadata.namespace,
                    "secret_type": secret.type,
                    "num_keys": num_keys,
                    "keys": list(secret.data.keys()) if secret.data else [],
                    "created": secret.metadata.creation_timestamp.isoformat() if secret.metadata.creation_timestamp else None,
                })
            self.emit({"type": "secrets", "count": len(items), "items": items})
        except ApiException as e:
            self.emit({"type": "secrets", "count": 0, "items": [], "error": str(e.reason)})

    def enum_cluster_roles(self):
        if not self.running:
            return
        try:
            result = self.rbac_v1.list_cluster_role()
            items = []
            for role in result.items:
                rules = []
                if role.rules:
                    for r in role.rules:
                        rules.append({
                            "verbs": r.verbs or [],
                            "resources": r.resources or [],
                            "api_groups": r.api_groups or [],
                        })
                items.append({
                    "name": role.metadata.name,
                    "rules": rules,
                })
            self.emit({"type": "cluster_roles", "count": len(items), "items": items})
        except ApiException as e:
            self.emit({"type": "cluster_roles", "count": 0, "items": [], "error": str(e.reason)})

    def enum_cluster_role_bindings(self):
        if not self.running:
            return
        try:
            result = self.rbac_v1.list_cluster_role_binding()
            items = []
            for binding in result.items:
                subjects = []
                if binding.subjects:
                    for s in binding.subjects:
                        subjects.append({
                            "kind": s.kind,
                            "name": s.name,
                            "namespace": s.namespace,
                        })
                items.append({
                    "name": binding.metadata.name,
                    "role_ref": binding.role_ref.name if binding.role_ref else None,
                    "subjects": subjects,
                })
            self.emit({"type": "cluster_role_bindings", "count": len(items), "items": items})
        except ApiException as e:
            self.emit({"type": "cluster_role_bindings", "count": 0, "items": [], "error": str(e.reason)})

    def enum_roles(self):
        if not self.running:
            return
        try:
            if self.args.namespace:
                result = self.rbac_v1.list_namespaced_role(namespace=self.args.namespace)
            else:
                result = self.rbac_v1.list_role_for_all_namespaces()
            items = []
            for role in result.items:
                rules = []
                if role.rules:
                    for r in role.rules:
                        rules.append({
                            "verbs": r.verbs or [],
                            "resources": r.resources or [],
                            "api_groups": r.api_groups or [],
                        })
                items.append({
                    "name": role.metadata.name,
                    "namespace": role.metadata.namespace,
                    "rules": rules,
                })
            self.emit({"type": "roles", "count": len(items), "items": items})
        except ApiException as e:
            self.emit({"type": "roles", "count": 0, "items": [], "error": str(e.reason)})

    def enum_role_bindings(self):
        if not self.running:
            return
        try:
            if self.args.namespace:
                result = self.rbac_v1.list_namespaced_role_binding(namespace=self.args.namespace)
            else:
                result = self.rbac_v1.list_role_binding_for_all_namespaces()
            items = []
            for binding in result.items:
                subjects = []
                if binding.subjects:
                    for s in binding.subjects:
                        subjects.append({
                            "kind": s.kind,
                            "name": s.name,
                            "namespace": s.namespace,
                        })
                items.append({
                    "name": binding.metadata.name,
                    "namespace": binding.metadata.namespace,
                    "role_ref": binding.role_ref.name if binding.role_ref else None,
                    "subjects": subjects,
                })
            self.emit({"type": "role_bindings", "count": len(items), "items": items})
        except ApiException as e:
            self.emit({"type": "role_bindings", "count": 0, "items": [], "error": str(e.reason)})

    def enum_ingresses(self):
        if not self.running:
            return
        try:
            if self.args.namespace:
                result = self.networking_v1.list_namespaced_ingress(namespace=self.args.namespace)
            else:
                result = self.networking_v1.list_ingress_for_all_namespaces()
            items = []
            for ing in result.items:
                rules = []
                if ing.spec and ing.spec.rules:
                    for rule in ing.spec.rules:
                        paths = []
                        if rule.http and rule.http.paths:
                            for p in rule.http.paths:
                                backend_name = ""
                                backend_port = ""
                                if p.backend and p.backend.service:
                                    backend_name = p.backend.service.name or ""
                                    if p.backend.service.port:
                                        backend_port = str(p.backend.service.port.number or p.backend.service.port.name or "")
                                paths.append({
                                    "path": p.path or "/",
                                    "path_type": p.path_type,
                                    "backend": f"{backend_name}:{backend_port}",
                                })
                        rules.append({
                            "host": rule.host or "*",
                            "paths": paths,
                        })
                tls_hosts = []
                if ing.spec and ing.spec.tls:
                    for tls in ing.spec.tls:
                        if tls.hosts:
                            tls_hosts.extend(tls.hosts)
                items.append({
                    "name": ing.metadata.name,
                    "namespace": ing.metadata.namespace,
                    "rules": rules,
                    "tls_hosts": tls_hosts,
                })
            self.emit({"type": "ingresses", "count": len(items), "items": items})
        except ApiException as e:
            self.emit({"type": "ingresses", "count": 0, "items": [], "error": str(e.reason)})

    def enum_service_accounts(self):
        if not self.running:
            return
        try:
            if self.args.namespace:
                result = self.v1.list_namespaced_service_account(namespace=self.args.namespace)
            else:
                result = self.v1.list_service_account_for_all_namespaces()
            items = []
            for sa in result.items:
                secrets_count = len(sa.secrets) if sa.secrets else 0
                items.append({
                    "name": sa.metadata.name,
                    "namespace": sa.metadata.namespace,
                    "secrets_count": secrets_count,
                    "automount_token": sa.automount_service_account_token,
                })
            self.emit({"type": "service_accounts", "count": len(items), "items": items})
        except ApiException as e:
            self.emit({"type": "service_accounts", "count": 0, "items": [], "error": str(e.reason)})

    def enum_nodes(self):
        if not self.running:
            return
        try:
            result = self.v1.list_node()
            items = []
            for node in result.items:
                status = "Unknown"
                if node.status and node.status.conditions:
                    for cond in node.status.conditions:
                        if cond.type == "Ready":
                            status = "Ready" if cond.status == "True" else "NotReady"
                            break
                roles = []
                if node.metadata.labels:
                    for label_key in node.metadata.labels:
                        if label_key.startswith("node-role.kubernetes.io/"):
                            roles.append(label_key.split("/")[1])
                kubelet_version = ""
                if node.status and node.status.node_info:
                    kubelet_version = node.status.node_info.kubelet_version
                items.append({
                    "name": node.metadata.name,
                    "status": status,
                    "roles": ", ".join(roles) if roles else "<none>",
                    "kubelet_version": kubelet_version,
                    "os_image": node.status.node_info.os_image if node.status and node.status.node_info else None,
                    "container_runtime": node.status.node_info.container_runtime_version if node.status and node.status.node_info else None,
                })
            self.emit({"type": "nodes", "count": len(items), "items": items})
        except ApiException as e:
            self.emit({"type": "nodes", "count": 0, "items": [], "error": str(e.reason)})

    def run(self):
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        load_k8s_config(self.args)
        self.v1 = client.CoreV1Api()
        self.rbac_v1 = client.RbacAuthorizationV1Api()
        self.networking_v1 = client.NetworkingV1Api()

        self.enum_namespaces()
        self.enum_pods()
        self.enum_services()
        self.enum_secrets()
        self.enum_cluster_roles()
        self.enum_cluster_role_bindings()
        self.enum_roles()
        self.enum_role_bindings()
        self.enum_ingresses()
        self.enum_service_accounts()
        self.enum_nodes()

        self.cleanup()

    def cleanup(self):
        print(f"\n--- k8s_enum summary ---")
        print(f"Categories enumerated: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Enumerate Kubernetes cluster resources for offensive reconnaissance.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 k8s_enum.py\n"
            "  python3 k8s_enum.py --namespace kube-system\n"
            "  python3 k8s_enum.py --json-output\n"
            "  python3 k8s_enum.py --kubeconfig /path/to/kubeconfig\n"
        ),
    )
    parser.add_argument("--namespace", type=str, default=None, help="Filter enumeration to a specific namespace")
    parser.add_argument("--kubeconfig", type=str, default=None, help="Path to kubeconfig file")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    enumerator = K8sEnumerator(args)
    enumerator.run()


if __name__ == "__main__":
    main()
