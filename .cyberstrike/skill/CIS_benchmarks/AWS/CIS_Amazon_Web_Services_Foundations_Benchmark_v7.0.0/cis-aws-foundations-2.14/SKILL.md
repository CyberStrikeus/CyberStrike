---
name: cis-aws-foundations-2.14
description: "Ensure IAM policies that allow full \"*:*\" administrative privileges are not attached"
category: cis-iam
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, iam, policies, admin-privileges, least-privilege, permissions]
cis_id: "2.14"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-2.13, cis-aws-foundations-2.15, cis-aws-foundations-2.21]
prerequisites: []
severity_boost: {}
---

# Ensure IAM policies that allow full "*:*" administrative privileges are not attached

## Description
IAM policies are the means by which privileges are granted to users, groups, or roles. It is recommended and considered standard security advice to grant least privilege, granting only the permissions required to perform a task. Determine what users need to do, and then craft policies for them that allow the users to perform only those tasks, instead of granting full administrative privileges.

## Rationale
It is more secure to start with a minimal set of permissions and grant additional permissions as necessary, rather than starting with overly permissive access and attempting to restrict it later.

Providing full administrative privileges instead of restricting access to the minimum required exposes resources to potentially unintended or malicious actions.

IAM policies that contain a statement with `"Effect": "Allow"` and `"Action": "*"` over `"Resource": "*"` should be removed.

## Impact
Policies granting full administrative privileges significantly increase the risk of unauthorized or unintended actions, potentially resulting in complete account compromise.

## Audit Procedure

### Using AWS CLI

1. Run the following to get a list of IAM policies:

```bash
aws iam list-policies --only-attached --output text
```

2. For each policy returned, evaluate the default policy version to determine if it allows full administrative privileges (":"). The default version represents the effective permissions applied.

3. Alternatively, the following command can be used to identify all attached policies that allow full administrative privileges and list associated entities:

```bash
policies=$(aws iam list-policies --scope All --only-attached --query 'Policies[*].Arn' --output text)

for arn in $policies; do
  version=$(aws iam get-policy --policy-arn "$arn" --query 'Policy.DefaultVersionId' --output text)

  is_admin=$(aws iam get-policy-version --policy-arn "$arn" --version-id "$version" --query 'PolicyVersion.Document' | jq -r '
    .Statement |
    (if type == "array" then .[] else . end) |
    select(.Effect == "Allow") |
    select(
        (.Action | if type == "array" then .[] else . end == "*") and
        (.Resource | if type == "array" then .[] else . end == "*")
    )
  ')

  if [ ! -z "$is_admin" ]; then
    echo "-------------------------------------------------------------"
    echo "ADMIN POLICY FOUND: $arn"
    echo "ATTACHED ENTITIES:"
    aws iam list-entities-for-policy --policy-arn "$arn" --query '{Users: PolicyUsers[*].UserName, Roles: PolicyRoles[*].RoleName, Groups: PolicyGroups[*].GroupName}' --output yaml
  fi
done
```

4. In the output, no policy should contain a statement with:
- "Effect": "Allow"
- "Action": "\*"
- "Resource": "\*"

### Using AWS Console

1. Sign in to the AWS Management Console and open the IAM console
2. In the navigation pane, click `Policies`
3. Search for the policy identified in the audit step
4. Select the policy
5. Choose `Detach`
6. Detach the policy from all `Users`, `Groups`, and `Roles`
7. Delete the policy if it is no longer required

## Expected Result
No attached IAM policies should contain a statement with `"Effect": "Allow"`, `"Action": "*"`, and `"Resource": "*"` simultaneously.

## Remediation

### Using AWS Console

1. Sign in to the AWS Management Console and open the IAM console
2. In the navigation pane, click `Policies`
3. Search for the policy identified in the audit step
4. Select the policy
5. Choose `Detach`
6. Detach the policy from all `Users`, `Groups`, and `Roles`
7. Delete the policy if it is no longer required

### Using AWS CLI

1. List all entities attached to the policy:

```bash
aws iam list-entities-for-policy --policy-arn <policy_arn>
```

2. Detach from users:

```bash
aws iam detach-user-policy --user-name <iam_user> --policy-arn <policy_arn>
```

3. Detach from groups:

```bash
aws iam detach-group-policy --group-name <iam_group> --policy-arn <policy_arn>
```

4. Detach from roles:

```bash
aws iam detach-role-policy --role-name <iam_role> --policy-arn <policy_arn>
```

## Default Value
By default, AWS allows the creation and attachment of IAM policies that grant full administrative privileges (i.e., "Effect": "Allow", "Action": "\*", "Resource": "\*"). No restriction exists unless enforced through organizational policy or Service Control Policies (SCPs).

## References
1. https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html
2. https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_managed-vs-inline.html
3. CCE-78912-3
4. https://docs.aws.amazon.com/cli/latest/reference/iam/index.html#cli-aws-iam

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 6.8 Define and Maintain Role-Based Access Control - Define and maintain role-based access control, through determining and documenting the access rights necessary for each role within the enterprise to successfully carry out its assigned duties. Perform access control reviews of enterprise assets to validate that all privileges are authorized, on a recurring schedule at a minimum annually, or more frequently. | | | x |
| v7 | 4.1 Maintain Inventory of Administrative Accounts - Use automated tools to inventory all administrative accounts, including domain and local accounts, to ensure that only authorized individuals have elevated privileges. | | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1078.004 | TA0003, TA0007, TA0008, TA0009, TA0010, TA0043 | M1018 |

## Profile
Level 1 | Automated
