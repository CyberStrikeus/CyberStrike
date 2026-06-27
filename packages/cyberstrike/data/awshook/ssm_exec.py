#!/usr/bin/env python3
"""
ssm_exec.py — AWS SSM Remote Command Execution

Executes commands on EC2 instances via AWS Systems Manager RunCommand.
Lists managed instances and retrieves command output.

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
    import boto3
    from botocore.exceptions import ClientError, NoCredentialsError
except ImportError:
    print("ERROR: boto3 required. Install: pip3 install boto3", file=sys.stderr)
    sys.exit(1)


def get_session(args):
    kwargs = {}
    if args.profile:
        kwargs["profile_name"] = args.profile
    if args.region:
        kwargs["region_name"] = args.region
    return boto3.Session(**kwargs)


class SsmExecutor:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True

    def signal_handler(self, signum, frame):
        self.running = False

    def print_banner(self):
        print("=" * 70)
        print("CyberStrike — AWS SSM Remote Execution")
        print("=" * 70)
        print(f"PID:        {os.getpid()}")
        print(f"Instance:   {self.args.instance_id or 'all (list)'}")
        print(f"Command:    {self.args.command or 'N/A'}")
        print(f"Timeout:    {self.args.timeout}s")
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
            print(f"[{action.upper():<12}] [{status.upper():<8}] {detail}", flush=True)
            if record.get("stdout"):
                print(f"  STDOUT: {record['stdout'][:500]}", flush=True)
            if record.get("stderr"):
                print(f"  STDERR: {record['stderr'][:500]}", flush=True)

    def list_instances(self, ssm):
        try:
            paginator = ssm.get_paginator("describe_instance_information")
            for page in paginator.paginate():
                if not self.running:
                    break
                for instance in page["InstanceInformationList"]:
                    self.emit({
                        "action": "instance",
                        "status": "online" if instance["PingStatus"] == "Online" else "offline",
                        "detail": f"{instance['InstanceId']} platform={instance.get('PlatformType', 'N/A')} version={instance.get('PlatformVersion', 'N/A')} agent={instance.get('AgentVersion', 'N/A')}",
                        "instance_id": instance["InstanceId"],
                        "platform_type": instance.get("PlatformType"),
                        "platform_name": instance.get("PlatformName"),
                        "platform_version": instance.get("PlatformVersion"),
                        "agent_version": instance.get("AgentVersion"),
                        "ping_status": instance["PingStatus"],
                        "ip_address": instance.get("IPAddress"),
                        "computer_name": instance.get("ComputerName"),
                    })
        except ClientError as e:
            self.emit({"action": "error", "status": "failed", "detail": f"list instances: {e}"})

    def execute_command(self, ssm, instance_id, command):
        try:
            result = ssm.send_command(
                InstanceIds=[instance_id],
                DocumentName="AWS-RunShellScript",
                Parameters={"commands": [command]},
                TimeoutSeconds=self.args.timeout,
                Comment=f"CyberStrike SSM exec",
            )
            command_id = result["Command"]["CommandId"]
            self.emit({"action": "send", "status": "success", "detail": f"Command {command_id} sent to {instance_id}"})
        except ClientError as e:
            self.emit({"action": "send", "status": "failed", "detail": f"send_command: {e}"})
            return

        deadline = time.monotonic() + self.args.timeout
        while self.running and time.monotonic() < deadline:
            try:
                invocation = ssm.get_command_invocation(CommandId=command_id, InstanceId=instance_id)
                status = invocation["Status"]
                if status in ("Success", "Failed", "Cancelled", "TimedOut"):
                    self.emit({
                        "action": "result",
                        "status": status.lower(),
                        "detail": f"Command {command_id} on {instance_id}: {status}",
                        "instance_id": instance_id,
                        "command_id": command_id,
                        "command": command,
                        "stdout": invocation.get("StandardOutputContent", ""),
                        "stderr": invocation.get("StandardErrorContent", ""),
                        "response_code": invocation.get("ResponseCode"),
                    })
                    return
            except ClientError as e:
                if "InvocationDoesNotExist" in str(e):
                    time.sleep(2)
                    continue
                self.emit({"action": "poll", "status": "error", "detail": str(e)})
                return
            time.sleep(2)

        self.emit({"action": "result", "status": "timeout", "detail": f"Command {command_id} timed out after {self.args.timeout}s"})

    def run(self):
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        session = get_session(self.args)
        ssm = session.client("ssm")

        if self.args.all_instances or not self.args.command:
            self.list_instances(ssm)

        if self.args.command and self.args.instance_id:
            self.execute_command(ssm, self.args.instance_id, self.args.command)
        elif self.args.command and not self.args.instance_id:
            self.emit({"action": "error", "status": "failed", "detail": "--instance-id is required when --command is specified"})

        self.cleanup()

    def cleanup(self):
        print(f"\n--- ssm_exec summary ---")
        print(f"Records: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Execute commands on EC2 instances via AWS SSM RunCommand.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 ssm_exec.py --all-instances\n"
            "  python3 ssm_exec.py --instance-id i-0123456789 --command 'whoami'\n"
            "  python3 ssm_exec.py --instance-id i-0123456789 --command 'cat /etc/shadow' --json-output\n"
        ),
    )
    parser.add_argument("--instance-id", type=str, default=None, help="Target EC2 instance ID")
    parser.add_argument("--all-instances", action="store_true", default=False, help="List all SSM-managed instances")
    parser.add_argument("--command", type=str, default=None, help="Shell command to execute")
    parser.add_argument("--timeout", type=int, default=60, help="Command timeout in seconds (default: 60)")
    parser.add_argument("--profile", type=str, default=None, help="AWS profile name")
    parser.add_argument("--region", type=str, default=None, help="AWS region")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    executor = SsmExecutor(args)
    executor.run()


if __name__ == "__main__":
    main()
