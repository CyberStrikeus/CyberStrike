#!/usr/bin/env python3
"""
cleanup_aws.py — AWS Resource Cleanup and Trail Restoration

Removes all resources created by CyberStrike awshook tools:
- Restores CloudTrail logging
- Deletes Lambda functions and layers
- Removes IAM roles, policies, and access keys
- Deletes EBS snapshots
- Cleans the state file

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
    import boto3
    from botocore.exceptions import ClientError
except ImportError:
    print("ERROR: boto3 required. Install: pip3 install boto3", file=sys.stderr)
    sys.exit(1)

STATE_FILE = str(Path.home() / ".cyberstrike" / "awshook-state.json")


def get_session(args):
    kwargs = {}
    if args.profile:
        kwargs["profile_name"] = args.profile
    if args.region:
        kwargs["region_name"] = args.region
    return boto3.Session(**kwargs)


def load_state():
    try:
        with open(STATE_FILE, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"created_resources": []}


class AwsCleaner:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.state = load_state()
        self.cleaned = 0
        self.failed = 0

    def signal_handler(self, signum, frame):
        self.running = False

    def print_banner(self):
        print("=" * 70)
        print("CyberStrike — AWS Cleanup")
        print("=" * 70)
        print(f"PID:        {os.getpid()}")
        print(f"Dry-run:    {self.args.dry_run}")
        print(f"State file: {STATE_FILE}")
        print(f"Resources:  {len(self.state.get('created_resources', []))}")
        print(f"Profile:    {self.args.profile or 'default'}")
        print(f"Region:     {self.args.region or 'default'}")
        print(f"Output:     {'JSON' if self.args.json_output else 'text'}")
        print(f"Started:    {datetime.now().isoformat()}")
        print("=" * 70)
        print()

    def emit(self, record):
        self.event_count += 1
        if self.args.json_output:
            print(json.dumps(record, default=str), flush=True)
        else:
            action = record.get("action", "info")
            status = record.get("status", "")
            detail = record.get("detail", "")
            print(f"[{action.upper():<16}] [{status.upper():<8}] {detail}", flush=True)

    def restore_cloudtrail(self, session):
        if not self.running:
            return
        ct = session.client("cloudtrail")
        stopped = [r for r in self.state.get("created_resources", []) if r["type"] == "stopped_trail"]
        for resource in stopped:
            if not self.running:
                break
            name = resource["id"]
            if self.args.dry_run:
                self.emit({"action": "restore_trail", "status": "dry_run", "detail": f"Would restart {name}"})
                continue
            try:
                ct.start_logging(Name=name)
                self.cleaned += 1
                self.emit({"action": "restore_trail", "status": "success", "detail": f"Restarted logging on {name}"})
            except ClientError as e:
                self.failed += 1
                self.emit({"action": "restore_trail", "status": "failed", "detail": f"{name}: {e}"})

    def delete_lambda_functions(self, session):
        if not self.running:
            return
        lam = session.client("lambda")
        functions = [r for r in self.state.get("created_resources", []) if r["type"] == "lambda_function"]
        for resource in functions:
            if not self.running:
                break
            name = resource["id"]
            if self.args.dry_run:
                self.emit({"action": "delete_lambda", "status": "dry_run", "detail": f"Would delete {name}"})
                continue
            try:
                lam.delete_function(FunctionName=name)
                self.cleaned += 1
                self.emit({"action": "delete_lambda", "status": "success", "detail": f"Deleted function {name}"})
            except ClientError as e:
                if "ResourceNotFoundException" in str(e):
                    self.emit({"action": "delete_lambda", "status": "not_found", "detail": f"{name} already deleted"})
                else:
                    self.failed += 1
                    self.emit({"action": "delete_lambda", "status": "failed", "detail": f"{name}: {e}"})

    def delete_lambda_layers(self, session):
        if not self.running:
            return
        lam = session.client("lambda")
        layers = [r for r in self.state.get("created_resources", []) if r["type"] == "lambda_layer"]
        for resource in layers:
            if not self.running:
                break
            name = resource["id"]
            arn = resource.get("arn", "")
            if self.args.dry_run:
                self.emit({"action": "delete_layer", "status": "dry_run", "detail": f"Would delete {name}"})
                continue
            try:
                versions = lam.list_layer_versions(LayerName=name).get("LayerVersions", [])
                for v in versions:
                    lam.delete_layer_version(LayerName=name, VersionNumber=v["Version"])
                self.cleaned += 1
                self.emit({"action": "delete_layer", "status": "success", "detail": f"Deleted layer {name} ({len(versions)} versions)"})
            except ClientError as e:
                if "ResourceNotFoundException" in str(e):
                    self.emit({"action": "delete_layer", "status": "not_found", "detail": f"{name} already deleted"})
                else:
                    self.failed += 1
                    self.emit({"action": "delete_layer", "status": "failed", "detail": f"{name}: {e}"})

    def delete_iam_resources(self, session):
        if not self.running:
            return
        iam = session.client("iam")

        access_keys = [r for r in self.state.get("created_resources", []) if r["type"] == "access_key"]
        for resource in access_keys:
            if not self.running:
                break
            key_id = resource["id"]
            username = resource.get("username", "")
            if self.args.dry_run:
                self.emit({"action": "delete_key", "status": "dry_run", "detail": f"Would delete key {key_id} for {username}"})
                continue
            try:
                iam.delete_access_key(UserName=username, AccessKeyId=key_id)
                self.cleaned += 1
                self.emit({"action": "delete_key", "status": "success", "detail": f"Deleted key {key_id} for {username}"})
            except ClientError as e:
                self.failed += 1
                self.emit({"action": "delete_key", "status": "failed", "detail": f"{key_id}: {e}"})

        policy_attachments = [r for r in self.state.get("created_resources", []) if r["type"] in ("user_policy_attachment", "role_policy_attachment")]
        for resource in policy_attachments:
            if not self.running:
                break
            name = resource["id"]
            policy = resource.get("policy", "AdministratorAccess")
            policy_arn = f"arn:aws:iam::aws:policy/{policy}"
            if self.args.dry_run:
                self.emit({"action": "detach_policy", "status": "dry_run", "detail": f"Would detach {policy} from {name}"})
                continue
            try:
                if resource["type"] == "user_policy_attachment":
                    iam.detach_user_policy(UserName=name, PolicyArn=policy_arn)
                else:
                    iam.detach_role_policy(RoleName=name, PolicyArn=policy_arn)
                self.cleaned += 1
                self.emit({"action": "detach_policy", "status": "success", "detail": f"Detached {policy} from {name}"})
            except ClientError as e:
                self.failed += 1
                self.emit({"action": "detach_policy", "status": "failed", "detail": f"{name}: {e}"})

        roles = [r for r in self.state.get("created_resources", []) if r["type"] == "iam_role"]
        for resource in roles:
            if not self.running:
                break
            role_name = resource["id"]
            if self.args.dry_run:
                self.emit({"action": "delete_role", "status": "dry_run", "detail": f"Would delete role {role_name}"})
                continue
            try:
                attached = iam.list_attached_role_policies(RoleName=role_name).get("AttachedPolicies", [])
                for p in attached:
                    iam.detach_role_policy(RoleName=role_name, PolicyArn=p["PolicyArn"])
                inline = iam.list_role_policies(RoleName=role_name).get("PolicyNames", [])
                for pn in inline:
                    iam.delete_role_policy(RoleName=role_name, PolicyName=pn)
                iam.delete_role(RoleName=role_name)
                self.cleaned += 1
                self.emit({"action": "delete_role", "status": "success", "detail": f"Deleted role {role_name}"})
            except ClientError as e:
                if "NoSuchEntity" in str(e):
                    self.emit({"action": "delete_role", "status": "not_found", "detail": f"{role_name} already deleted"})
                else:
                    self.failed += 1
                    self.emit({"action": "delete_role", "status": "failed", "detail": f"{role_name}: {e}"})

        logins = [r for r in self.state.get("created_resources", []) if r["type"] == "login_profile"]
        for resource in logins:
            if not self.running:
                break
            username = resource["id"]
            if self.args.dry_run:
                self.emit({"action": "delete_login", "status": "dry_run", "detail": f"Would delete login for {username}"})
                continue
            try:
                iam.delete_login_profile(UserName=username)
                self.cleaned += 1
                self.emit({"action": "delete_login", "status": "success", "detail": f"Deleted login profile for {username}"})
            except ClientError as e:
                self.failed += 1
                self.emit({"action": "delete_login", "status": "failed", "detail": f"{username}: {e}"})

    def delete_snapshots(self, session):
        if not self.running:
            return
        ec2 = session.client("ec2")
        snapshots = [r for r in self.state.get("created_resources", []) if r["type"] == "ebs_snapshot"]
        for resource in snapshots:
            if not self.running:
                break
            snap_id = resource["id"]
            if self.args.dry_run:
                self.emit({"action": "delete_snap", "status": "dry_run", "detail": f"Would delete {snap_id}"})
                continue
            try:
                ec2.delete_snapshot(SnapshotId=snap_id)
                self.cleaned += 1
                self.emit({"action": "delete_snap", "status": "success", "detail": f"Deleted snapshot {snap_id}"})
            except ClientError as e:
                if "InvalidSnapshot.NotFound" in str(e):
                    self.emit({"action": "delete_snap", "status": "not_found", "detail": f"{snap_id} already deleted"})
                else:
                    self.failed += 1
                    self.emit({"action": "delete_snap", "status": "failed", "detail": f"{snap_id}: {e}"})

    def run(self):
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        session = get_session(self.args)

        self.restore_cloudtrail(session)
        self.delete_lambda_functions(session)
        self.delete_lambda_layers(session)
        self.delete_iam_resources(session)
        self.delete_snapshots(session)

        if not self.args.dry_run:
            try:
                os.remove(STATE_FILE)
                self.emit({"action": "cleanup", "status": "success", "detail": f"Deleted state file {STATE_FILE}"})
            except FileNotFoundError:
                pass
            except OSError as e:
                self.emit({"action": "cleanup", "status": "failed", "detail": f"Cannot delete state file: {e}"})

        self.cleanup()

    def cleanup(self):
        print(f"\n--- cleanup_aws summary ---")
        print(f"Mode:    {'DRY RUN' if self.args.dry_run else 'LIVE'}")
        print(f"Cleaned: {self.cleaned}")
        print(f"Failed:  {self.failed}")
        print(f"Records: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Clean up all AWS resources created by CyberStrike awshook tools.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 cleanup_aws.py --dry-run\n"
            "  python3 cleanup_aws.py\n"
            "  python3 cleanup_aws.py --profile prod --json-output\n"
        ),
    )
    parser.add_argument("--dry-run", action="store_true", default=False, help="Show what would be cleaned without acting")
    parser.add_argument("--profile", type=str, default=None, help="AWS profile name")
    parser.add_argument("--region", type=str, default=None, help="AWS region")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    cleaner = AwsCleaner(args)
    cleaner.run()


if __name__ == "__main__":
    main()
