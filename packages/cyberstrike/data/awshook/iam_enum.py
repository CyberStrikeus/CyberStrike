#!/usr/bin/env python3
"""
iam_enum.py — AWS IAM Enumeration and Privilege Escalation Path Analysis

Enumerates IAM users, roles, groups, and policies. Identifies dangerous permissions
and privilege escalation paths (PassRole, AssumeRole, AttachPolicy, CreateKey, etc.).

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


DANGEROUS_ACTIONS = [
    "iam:PassRole",
    "iam:CreatePolicy",
    "iam:AttachUserPolicy",
    "iam:AttachRolePolicy",
    "iam:AttachGroupPolicy",
    "iam:PutUserPolicy",
    "iam:PutRolePolicy",
    "iam:PutGroupPolicy",
    "iam:CreateLoginProfile",
    "iam:UpdateLoginProfile",
    "iam:CreateAccessKey",
    "iam:CreateServiceLinkedRole",
    "lambda:CreateFunction",
    "lambda:InvokeFunction",
    "lambda:UpdateFunctionCode",
    "sts:AssumeRole",
    "ec2:RunInstances",
    "glue:CreateJob",
    "glue:StartJobRun",
    "cloudformation:CreateStack",
    "datapipeline:CreatePipeline",
    "iam:CreateUser",
    "iam:AddUserToGroup",
    "*",
]


def get_session(args):
    kwargs = {}
    if args.profile:
        kwargs["profile_name"] = args.profile
    if args.region:
        kwargs["region_name"] = args.region
    return boto3.Session(**kwargs)


class IamEnumerator:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True

    def signal_handler(self, signum, frame):
        self.running = False

    def print_banner(self):
        print("=" * 70)
        print("CyberStrike — AWS IAM Enumeration")
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
            rtype = record.get("type", "info")
            name = record.get("name", "unknown")
            detail = record.get("detail", "")
            print(f"[{rtype.upper():<12}] {name:<40} {detail}", flush=True)

    def get_policy_actions(self, iam, policy_arn):
        actions = set()
        try:
            version = iam.get_policy(PolicyArn=policy_arn)["Policy"]["DefaultVersionId"]
            doc = iam.get_policy_version(PolicyArn=policy_arn, VersionId=version)["PolicyVersion"]["Document"]
            statements = doc.get("Statement", [])
            if isinstance(statements, dict):
                statements = [statements]
            for stmt in statements:
                if stmt.get("Effect") != "Allow":
                    continue
                stmt_actions = stmt.get("Action", [])
                if isinstance(stmt_actions, str):
                    stmt_actions = [stmt_actions]
                actions.update(stmt_actions)
        except ClientError:
            pass
        return actions

    def get_inline_policy_actions(self, iam, entity_type, entity_name, policy_name):
        actions = set()
        try:
            if entity_type == "user":
                doc = iam.get_user_policy(UserName=entity_name, PolicyName=policy_name)["PolicyDocument"]
            elif entity_type == "role":
                doc = iam.get_role_policy(RoleName=entity_name, PolicyName=policy_name)["PolicyDocument"]
            elif entity_type == "group":
                doc = iam.get_group_policy(GroupName=entity_name, PolicyName=policy_name)["PolicyDocument"]
            else:
                return actions
            statements = doc.get("Statement", [])
            if isinstance(statements, dict):
                statements = [statements]
            for stmt in statements:
                if stmt.get("Effect") != "Allow":
                    continue
                stmt_actions = stmt.get("Action", [])
                if isinstance(stmt_actions, str):
                    stmt_actions = [stmt_actions]
                actions.update(stmt_actions)
        except ClientError:
            pass
        return actions

    def find_dangerous(self, actions):
        dangerous = []
        for action in actions:
            if action == "*":
                dangerous.append("*")
                continue
            for da in DANGEROUS_ACTIONS:
                if action.lower() == da.lower():
                    dangerous.append(action)
                elif "*" in action:
                    prefix = action.split("*")[0].lower()
                    if da.lower().startswith(prefix):
                        dangerous.append(f"{action} (matches {da})")
        return list(set(dangerous))

    def find_privesc_paths(self, dangerous):
        paths = []
        d_lower = [d.split(" (")[0].lower() for d in dangerous]
        if "*" in d_lower:
            paths.append("FULL ADMIN — wildcard * permissions")
        if "iam:passrole" in d_lower and "lambda:createfunction" in d_lower:
            paths.append("PassRole+Lambda — create Lambda with high-priv role")
        if "iam:passrole" in d_lower and "ec2:runinstances" in d_lower:
            paths.append("PassRole+EC2 — launch instance with admin role")
        if "iam:attachuserpolicy" in d_lower or "iam:attachrolepolicy" in d_lower:
            paths.append("AttachPolicy — attach AdministratorAccess")
        if "iam:putuserpolicy" in d_lower or "iam:putrolepolicy" in d_lower:
            paths.append("PutPolicy — inject inline admin policy")
        if "iam:createloginprofile" in d_lower:
            paths.append("CreateLoginProfile — set console password for any user")
        if "iam:createaccesskey" in d_lower:
            paths.append("CreateAccessKey — generate keys for any user")
        if "iam:addusertogroup" in d_lower:
            paths.append("AddUserToGroup — add self to admin group")
        if "iam:passrole" in d_lower and "glue:createjob" in d_lower:
            paths.append("PassRole+Glue — create Glue job with admin role")
        return paths

    def enum_caller_identity(self, session):
        sts = session.client("sts")
        try:
            identity = sts.get_caller_identity()
            self.emit({
                "type": "identity",
                "name": identity.get("Arn", "unknown"),
                "detail": f"Account={identity.get('Account', 'N/A')} UserId={identity.get('UserId', 'N/A')}",
                "account": identity.get("Account"),
                "arn": identity.get("Arn"),
                "user_id": identity.get("UserId"),
            })
        except (ClientError, NoCredentialsError) as e:
            print(f"ERROR: Cannot get caller identity: {e}", file=sys.stderr)
            sys.exit(1)

    def enum_users(self, iam):
        if not self.running:
            return
        try:
            paginator = iam.get_paginator("list_users")
            for page in paginator.paginate():
                if not self.running:
                    break
                for user in page["Users"]:
                    if not self.running:
                        break
                    username = user["UserName"]
                    all_actions = set()

                    attached = iam.list_attached_user_policies(UserName=username).get("AttachedPolicies", [])
                    attached_names = [p["PolicyName"] for p in attached]
                    for p in attached:
                        all_actions.update(self.get_policy_actions(iam, p["PolicyArn"]))

                    inline = iam.list_user_policies(UserName=username).get("PolicyNames", [])
                    for pn in inline:
                        all_actions.update(self.get_inline_policy_actions(iam, "user", username, pn))

                    groups = iam.list_groups_for_user(UserName=username).get("Groups", [])
                    group_names = [g["GroupName"] for g in groups]

                    try:
                        mfa = iam.list_mfa_devices(UserName=username).get("MFADevices", [])
                    except ClientError:
                        mfa = []

                    try:
                        keys = iam.list_access_keys(UserName=username).get("AccessKeyMetadata", [])
                    except ClientError:
                        keys = []

                    dangerous = self.find_dangerous(all_actions)
                    privesc = self.find_privesc_paths(dangerous)

                    self.emit({
                        "type": "user",
                        "name": username,
                        "detail": f"policies={len(attached_names)+len(inline)} groups={len(group_names)} mfa={'yes' if mfa else 'NO'} keys={len(keys)} dangerous={len(dangerous)}",
                        "arn": user["Arn"],
                        "attached_policies": attached_names,
                        "inline_policies": inline,
                        "groups": group_names,
                        "mfa_enabled": bool(mfa),
                        "access_keys": [{"id": k["AccessKeyId"], "status": k["Status"], "created": k.get("CreateDate")} for k in keys],
                        "dangerous_permissions": dangerous,
                        "privesc_paths": privesc,
                        "created": user.get("CreateDate"),
                        "last_used": user.get("PasswordLastUsed"),
                    })
        except ClientError as e:
            self.emit({"type": "error", "name": "list_users", "detail": str(e)})

    def enum_roles(self, iam):
        if not self.running:
            return
        try:
            paginator = iam.get_paginator("list_roles")
            for page in paginator.paginate():
                if not self.running:
                    break
                for role in page["Roles"]:
                    if not self.running:
                        break
                    rolename = role["RoleName"]
                    trust = role.get("AssumeRolePolicyDocument", {})

                    all_actions = set()
                    attached = iam.list_attached_role_policies(RoleName=rolename).get("AttachedPolicies", [])
                    attached_names = [p["PolicyName"] for p in attached]
                    for p in attached:
                        all_actions.update(self.get_policy_actions(iam, p["PolicyArn"]))

                    inline = iam.list_role_policies(RoleName=rolename).get("PolicyNames", [])
                    for pn in inline:
                        all_actions.update(self.get_inline_policy_actions(iam, "role", rolename, pn))

                    dangerous = self.find_dangerous(all_actions)

                    trust_principals = []
                    for stmt in trust.get("Statement", []):
                        principal = stmt.get("Principal", {})
                        if isinstance(principal, str):
                            trust_principals.append(principal)
                        elif isinstance(principal, dict):
                            for k, v in principal.items():
                                if isinstance(v, list):
                                    trust_principals.extend(v)
                                else:
                                    trust_principals.append(v)

                    assumable_by_anyone = "*" in trust_principals

                    self.emit({
                        "type": "role",
                        "name": rolename,
                        "detail": f"policies={len(attached_names)+len(inline)} trust_principals={len(trust_principals)} dangerous={len(dangerous)} wildcard_trust={'YES' if assumable_by_anyone else 'no'}",
                        "arn": role["Arn"],
                        "attached_policies": attached_names,
                        "inline_policies": inline,
                        "trust_principals": trust_principals,
                        "assumable_by_anyone": assumable_by_anyone,
                        "dangerous_permissions": dangerous,
                        "created": role.get("CreateDate"),
                    })
        except ClientError as e:
            self.emit({"type": "error", "name": "list_roles", "detail": str(e)})

    def enum_groups(self, iam):
        if not self.running:
            return
        try:
            paginator = iam.get_paginator("list_groups")
            for page in paginator.paginate():
                if not self.running:
                    break
                for group in page["Groups"]:
                    if not self.running:
                        break
                    gname = group["GroupName"]

                    attached = iam.list_attached_group_policies(GroupName=gname).get("AttachedPolicies", [])
                    attached_names = [p["PolicyName"] for p in attached]
                    inline = iam.list_group_policies(GroupName=gname).get("PolicyNames", [])

                    members = iam.get_group(GroupName=gname).get("Users", [])
                    member_names = [u["UserName"] for u in members]

                    self.emit({
                        "type": "group",
                        "name": gname,
                        "detail": f"policies={len(attached_names)+len(inline)} members={len(member_names)}",
                        "arn": group["Arn"],
                        "attached_policies": attached_names,
                        "inline_policies": inline,
                        "members": member_names,
                    })
        except ClientError as e:
            self.emit({"type": "error", "name": "list_groups", "detail": str(e)})

    def run(self):
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        session = get_session(self.args)
        self.enum_caller_identity(session)

        iam = session.client("iam")
        self.enum_users(iam)
        self.enum_roles(iam)
        self.enum_groups(iam)

        self.cleanup()

    def cleanup(self):
        print(f"\n--- iam_enum summary ---")
        print(f"Total records: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Enumerate AWS IAM users, roles, groups, and identify privilege escalation paths.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 iam_enum.py\n"
            "  python3 iam_enum.py --profile dev --json-output\n"
            "  python3 iam_enum.py --region us-east-1\n"
        ),
    )
    parser.add_argument("--profile", type=str, default=None, help="AWS profile name")
    parser.add_argument("--region", type=str, default=None, help="AWS region")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    enumerator = IamEnumerator(args)
    enumerator.run()


if __name__ == "__main__":
    main()
