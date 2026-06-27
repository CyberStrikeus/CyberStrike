#!/usr/bin/env python3
"""
ec2_snapshot.py — AWS EBS Volume Snapshot and Cross-Account Sharing

Snapshots EBS volumes and optionally shares them with external accounts
for offline data access.

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


class Ec2Snapshotter:
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
        print("CyberStrike — AWS EBS Volume Snapshot")
        print("=" * 70)
        print(f"PID:          {os.getpid()}")
        print(f"Volume ID:    {self.args.volume_id or 'all'}")
        print(f"Share with:   {self.args.share_account or 'none'}")
        print(f"Profile:      {self.args.profile or 'default'}")
        print(f"Region:       {self.args.region or 'default'}")
        print(f"Output:       {'JSON' if self.args.json_output else 'text'}")
        print(f"Started:      {datetime.now().isoformat()}")
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
            print(f"[{action.upper():<14}] [{status.upper():<10}] {detail}", flush=True)

    def track_resource(self, resource_type, resource_id, **extra):
        entry = {"type": resource_type, "id": resource_id, "created_at": datetime.now().isoformat()}
        entry.update(extra)
        self.state["created_resources"].append(entry)
        save_state(self.state)

    def snapshot_volume(self, ec2, volume_id):
        if not self.running:
            return None

        try:
            vol = ec2.describe_volumes(VolumeIds=[volume_id])["Volumes"][0]
            self.emit({
                "action": "volume_info",
                "status": "found",
                "detail": f"{volume_id} size={vol['Size']}GB state={vol['State']} az={vol['AvailabilityZone']}",
                "volume_id": volume_id,
                "size_gb": vol["Size"],
                "state": vol["State"],
                "availability_zone": vol["AvailabilityZone"],
                "encrypted": vol.get("Encrypted", False),
                "attachments": [{"instance_id": a["InstanceId"], "device": a["Device"], "state": a["State"]} for a in vol.get("Attachments", [])],
            })
        except ClientError as e:
            self.emit({"action": "volume_info", "status": "failed", "detail": f"{volume_id}: {e}"})
            return None

        try:
            snapshot = ec2.create_snapshot(
                VolumeId=volume_id,
                Description=f"CyberStrike snapshot {datetime.now().isoformat()}",
                TagSpecifications=[{
                    "ResourceType": "snapshot",
                    "Tags": [{"Key": "app", "Value": "cyberstrike"}, {"Key": "source_volume", "Value": volume_id}],
                }],
            )
            snap_id = snapshot["SnapshotId"]
            self.track_resource("ebs_snapshot", snap_id, volume_id=volume_id)
            self.emit({
                "action": "create_snap",
                "status": "success",
                "detail": f"Snapshot {snap_id} from {volume_id}",
                "snapshot_id": snap_id,
                "volume_id": volume_id,
            })

            self.emit({"action": "wait", "status": "info", "detail": f"Waiting for snapshot {snap_id} to complete..."})
            waiter = ec2.get_waiter("snapshot_completed")
            waiter.wait(SnapshotIds=[snap_id], WaiterConfig={"Delay": 5, "MaxAttempts": 60})

            self.emit({"action": "snapshot", "status": "completed", "detail": f"Snapshot {snap_id} ready"})
            return snap_id
        except ClientError as e:
            self.emit({"action": "create_snap", "status": "failed", "detail": str(e)})
            return None

    def share_snapshot(self, ec2, snapshot_id, account_id):
        if not self.running:
            return
        try:
            ec2.modify_snapshot_attribute(
                SnapshotId=snapshot_id,
                Attribute="createVolumePermission",
                OperationType="add",
                UserIds=[account_id],
            )
            self.emit({
                "action": "share",
                "status": "success",
                "detail": f"Shared {snapshot_id} with account {account_id}",
                "snapshot_id": snapshot_id,
                "shared_with": account_id,
            })
        except ClientError as e:
            self.emit({"action": "share", "status": "failed", "detail": str(e)})

    def run(self):
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        session = get_session(self.args)
        ec2 = session.client("ec2")

        if self.args.volume_id:
            volume_ids = [self.args.volume_id]
        else:
            try:
                volumes = ec2.describe_volumes().get("Volumes", [])
                volume_ids = [v["VolumeId"] for v in volumes]
                self.emit({"action": "enumerate", "status": "info", "detail": f"Found {len(volume_ids)} volumes"})
            except ClientError as e:
                self.emit({"action": "enumerate", "status": "failed", "detail": str(e)})
                volume_ids = []

        for vid in volume_ids:
            if not self.running:
                break
            snap_id = self.snapshot_volume(ec2, vid)
            if snap_id and self.args.share_account:
                self.share_snapshot(ec2, snap_id, self.args.share_account)

        self.cleanup()

    def cleanup(self):
        print(f"\n--- ec2_snapshot summary ---")
        print(f"Records: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Snapshot AWS EBS volumes and optionally share cross-account.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 ec2_snapshot.py --volume-id vol-0123456789abcdef\n"
            "  python3 ec2_snapshot.py --volume-id vol-0123456789abcdef --share-account 123456789012\n"
        ),
    )
    parser.add_argument("--volume-id", type=str, default=None, help="EBS volume ID (or omit for all volumes)")
    parser.add_argument("--share-account", type=str, default=None, help="AWS account ID to share snapshot with")
    parser.add_argument("--profile", type=str, default=None, help="AWS profile name")
    parser.add_argument("--region", type=str, default=None, help="AWS region")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    snapshotter = Ec2Snapshotter(args)
    snapshotter.run()


if __name__ == "__main__":
    main()
