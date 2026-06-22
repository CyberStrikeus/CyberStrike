#!/usr/bin/env python3
"""
cleanup_k8s.py — Kubernetes Resource Cleanup

Removes all CyberStrike-created resources from a Kubernetes cluster.
Reads tracked resources from ~/.cyberstrike/kubehook-state.json and
also searches by label selector 'app=cyberstrike' across the cluster.

Cleans up: DaemonSets, CronJobs, ClusterRoleBindings, Pods,
ServiceAccounts, and any other namespaced resources with cyberstrike labels.

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


STATE_FILE = os.path.expanduser("~/.cyberstrike/kubehook-state.json")
LABEL_SELECTOR = "app=cyberstrike"


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
    """Load state file for tracked resources."""
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {"created_resources": []}


def delete_state_file():
    """Remove the state file."""
    try:
        if os.path.exists(STATE_FILE):
            os.unlink(STATE_FILE)
            return True
    except OSError:
        pass
    return False


class K8sCleaner:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.v1 = None
        self.apps_v1 = None
        self.batch_v1 = None
        self.rbac_v1 = None
        self.state = load_state()
        self.deleted_count = 0
        self.failed_count = 0
        self.skipped_count = 0

    def signal_handler(self, signum, frame):
        self.running = False

    def print_banner(self):
        print("=" * 70)
        print("CyberStrike — Kubernetes Resource Cleanup")
        print("=" * 70)
        print(f"PID:        {os.getpid()}")
        print(f"Mode:       {'DRY RUN' if self.args.dry_run else 'LIVE'}")
        print(f"Output:     {'JSON' if self.args.json_output else 'text'}")
        print(f"Started:    {datetime.now().isoformat()}")
        tracked = len(self.state.get("created_resources", []))
        print(f"Tracked:    {tracked} resources in state file")
        print("=" * 70)
        print()

    def emit(self, record):
        self.event_count += 1
        if self.args.json_output:
            print(json.dumps(record), flush=True)
        else:
            action = record.get("action", "info")
            status = record.get("status", "info")
            kind = record.get("kind", "unknown")
            name = record.get("name", "unknown")
            namespace = record.get("namespace", "cluster")
            print(f"[{action.upper()}] [{status.upper()}] {kind} {namespace}/{name}", flush=True)
            if record.get("details"):
                print(f"  details: {record['details']}", flush=True)
            if record.get("error"):
                print(f"  error: {record['error']}", flush=True)

    def delete_resource(self, kind, name, namespace=None):
        """Delete a Kubernetes resource by kind and name."""
        if self.args.dry_run:
            self.skipped_count += 1
            self.emit({
                "timestamp": datetime.now().isoformat(),
                "action": "dry_run",
                "status": "would_delete",
                "kind": kind,
                "name": name,
                "namespace": namespace,
                "details": f"Would delete {kind} {namespace or 'cluster'}/{name}",
            })
            return True

        try:
            if kind == "DaemonSet" and namespace:
                self.apps_v1.delete_namespaced_daemon_set(name=name, namespace=namespace)
            elif kind == "CronJob" and namespace:
                self.batch_v1.delete_namespaced_cron_job(name=name, namespace=namespace)
            elif kind == "ClusterRoleBinding":
                self.rbac_v1.delete_cluster_role_binding(name=name)
            elif kind == "Pod" and namespace:
                self.v1.delete_namespaced_pod(name=name, namespace=namespace)
            elif kind == "ServiceAccount" and namespace:
                self.v1.delete_namespaced_service_account(name=name, namespace=namespace)
            elif kind == "Job" and namespace:
                self.batch_v1.delete_namespaced_job(
                    name=name, namespace=namespace,
                    body=client.V1DeleteOptions(propagation_policy="Background"),
                )
            else:
                self.failed_count += 1
                self.emit({
                    "timestamp": datetime.now().isoformat(),
                    "action": "delete",
                    "status": "unsupported",
                    "kind": kind,
                    "name": name,
                    "namespace": namespace,
                    "error": f"Unsupported resource kind: {kind}",
                })
                return False

            self.deleted_count += 1
            self.emit({
                "timestamp": datetime.now().isoformat(),
                "action": "delete",
                "status": "success",
                "kind": kind,
                "name": name,
                "namespace": namespace,
                "details": f"Deleted {kind} {namespace or 'cluster'}/{name}",
            })
            return True

        except ApiException as e:
            if e.status == 404:
                self.emit({
                    "timestamp": datetime.now().isoformat(),
                    "action": "delete",
                    "status": "not_found",
                    "kind": kind,
                    "name": name,
                    "namespace": namespace,
                    "details": "Resource already deleted or not found",
                })
                return True
            self.failed_count += 1
            self.emit({
                "timestamp": datetime.now().isoformat(),
                "action": "delete",
                "status": "error",
                "kind": kind,
                "name": name,
                "namespace": namespace,
                "error": f"Failed to delete: {e.reason}",
            })
            return False

    def cleanup_from_state(self):
        """Delete resources tracked in the state file."""
        resources = self.state.get("created_resources", [])
        if not resources:
            self.emit({
                "timestamp": datetime.now().isoformat(),
                "action": "scan",
                "status": "info",
                "kind": "state_file",
                "name": STATE_FILE,
                "details": "No tracked resources in state file",
            })
            return

        for resource in resources:
            if not self.running:
                break
            kind = resource.get("kind", "unknown")
            name = resource.get("name", "unknown")
            namespace = resource.get("namespace")
            self.delete_resource(kind, name, namespace)

    def cleanup_by_label(self):
        """Find and delete resources with app=cyberstrike label."""
        if not self.running:
            return

        # DaemonSets
        try:
            result = self.apps_v1.list_daemon_set_for_all_namespaces(label_selector=LABEL_SELECTOR)
            for ds in result.items:
                if not self.running:
                    break
                self.delete_resource("DaemonSet", ds.metadata.name, ds.metadata.namespace)
        except ApiException as e:
            self.emit({
                "timestamp": datetime.now().isoformat(),
                "action": "scan",
                "status": "error",
                "kind": "DaemonSet",
                "name": "*",
                "error": f"Failed to list DaemonSets: {e.reason}",
            })

        if not self.running:
            return

        # CronJobs
        try:
            result = self.batch_v1.list_cron_job_for_all_namespaces(label_selector=LABEL_SELECTOR)
            for cj in result.items:
                if not self.running:
                    break
                self.delete_resource("CronJob", cj.metadata.name, cj.metadata.namespace)
        except ApiException as e:
            self.emit({
                "timestamp": datetime.now().isoformat(),
                "action": "scan",
                "status": "error",
                "kind": "CronJob",
                "name": "*",
                "error": f"Failed to list CronJobs: {e.reason}",
            })

        if not self.running:
            return

        # Jobs (created by CronJobs)
        try:
            result = self.batch_v1.list_job_for_all_namespaces(label_selector=LABEL_SELECTOR)
            for job in result.items:
                if not self.running:
                    break
                self.delete_resource("Job", job.metadata.name, job.metadata.namespace)
        except ApiException as e:
            self.emit({
                "timestamp": datetime.now().isoformat(),
                "action": "scan",
                "status": "error",
                "kind": "Job",
                "name": "*",
                "error": f"Failed to list Jobs: {e.reason}",
            })

        if not self.running:
            return

        # ClusterRoleBindings
        try:
            result = self.rbac_v1.list_cluster_role_binding(label_selector=LABEL_SELECTOR)
            for crb in result.items:
                if not self.running:
                    break
                self.delete_resource("ClusterRoleBinding", crb.metadata.name)
        except ApiException as e:
            self.emit({
                "timestamp": datetime.now().isoformat(),
                "action": "scan",
                "status": "error",
                "kind": "ClusterRoleBinding",
                "name": "*",
                "error": f"Failed to list ClusterRoleBindings: {e.reason}",
            })

        if not self.running:
            return

        # Pods
        try:
            result = self.v1.list_pod_for_all_namespaces(label_selector=LABEL_SELECTOR)
            for pod in result.items:
                if not self.running:
                    break
                self.delete_resource("Pod", pod.metadata.name, pod.metadata.namespace)
        except ApiException as e:
            self.emit({
                "timestamp": datetime.now().isoformat(),
                "action": "scan",
                "status": "error",
                "kind": "Pod",
                "name": "*",
                "error": f"Failed to list Pods: {e.reason}",
            })

        if not self.running:
            return

        # ServiceAccounts
        try:
            result = self.v1.list_service_account_for_all_namespaces(label_selector=LABEL_SELECTOR)
            for sa in result.items:
                if not self.running:
                    break
                self.delete_resource("ServiceAccount", sa.metadata.name, sa.metadata.namespace)
        except ApiException as e:
            self.emit({
                "timestamp": datetime.now().isoformat(),
                "action": "scan",
                "status": "error",
                "kind": "ServiceAccount",
                "name": "*",
                "error": f"Failed to list ServiceAccounts: {e.reason}",
            })

    def run(self):
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        load_k8s_config(self.args)
        self.v1 = client.CoreV1Api()
        self.apps_v1 = client.AppsV1Api()
        self.batch_v1 = client.BatchV1Api()
        self.rbac_v1 = client.RbacAuthorizationV1Api()

        self.cleanup_from_state()
        self.cleanup_by_label()

        if not self.args.dry_run:
            if delete_state_file():
                self.emit({
                    "timestamp": datetime.now().isoformat(),
                    "action": "delete",
                    "status": "success",
                    "kind": "state_file",
                    "name": STATE_FILE,
                    "details": "State file deleted",
                })

        self.cleanup()

    def cleanup(self):
        print(f"\n--- cleanup_k8s summary ---")
        print(f"Mode: {'DRY RUN' if self.args.dry_run else 'LIVE'}")
        print(f"Resources deleted: {self.deleted_count}")
        print(f"Resources failed: {self.failed_count}")
        if self.args.dry_run:
            print(f"Resources would delete: {self.skipped_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Clean up all CyberStrike resources from a Kubernetes cluster.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 cleanup_k8s.py --dry-run\n"
            "  python3 cleanup_k8s.py\n"
            "  python3 cleanup_k8s.py --json-output\n"
            "  python3 cleanup_k8s.py --kubeconfig /path/to/kubeconfig\n"
        ),
    )
    parser.add_argument("--dry-run", action="store_true", default=False,
                        help="Show what would be deleted without actually deleting")
    parser.add_argument("--kubeconfig", type=str, default=None, help="Path to kubeconfig file")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    cleaner = K8sCleaner(args)
    cleaner.run()


if __name__ == "__main__":
    main()
