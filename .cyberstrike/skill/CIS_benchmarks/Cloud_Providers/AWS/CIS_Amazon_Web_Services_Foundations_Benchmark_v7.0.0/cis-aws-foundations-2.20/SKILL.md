---
name: cis-aws-foundations-2.20
description: "Ensure access to AWSCloudShellFullAccess is restricted"
category: cis-iam
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, iam, cloudshell, data-exfiltration, least-privilege, policies]
cis_id: "2.20"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-2.14, cis-aws-foundations-2.13]
prerequisites: []
severity_boost: {}
---

# Ensure access to AWSCloudShellFullAccess is restricted

## Description

AWS CloudShell is a convenient way of running CLI commands against AWS services. The managed IAM policy `AWSCloudShellFullAccess` provides full access to CloudShell, including file upload and download capability between a user's local system and the CloudShell environment. Within the CloudShell environment, a user has sudo permissions and can access the internet. It is therefore possible to install software and transfer data to external systems.

## Rationale

Access to this policy should be restricted, as it presents a potential channel for data exfiltration by privileged users. AWS documentation provides guidance on creating more restrictive policies that limit file transfer capabilities.

## Impact

Unrestricted access to CloudShell may allow users to transfer data outside the AWS environment, increasing the risk of data exfiltration and loss of sensitive information.

## Audit Procedure

### Using AWS Console

1. Sign in to the AWS Management Console and open the IAM console at https://console.aws.amazon.com/iam
2. In the left pane, select `Policies`
3. Search for and select `AWSCloudShellFullAccess`
4. Select the `Entities attached` tab
5. Ensure that no users, groups, or roles are attached

### Using AWS CLI

1. Run the following command:

```bash
aws iam list-entities-for-policy --policy-arn arn:aws:iam::aws:policy/AWSCloudShellFullAccess
```

2. In the output, ensure the following are empty:

- PolicyUsers
- PolicyRoles
- PolicyGroups

Example:

```
PolicyRoles: [ ]
```

## Expected Result

The `AWSCloudShellFullAccess` policy should not be attached to any users, groups, or roles. All three lists (`PolicyUsers`, `PolicyRoles`, `PolicyGroups`) should be empty.

## Remediation

### Using AWS Console

1. Open the IAM console at https://console.aws.amazon.com/iam/
2. In the left pane, select `Policies`
3. Search for and select `AWSCloudShellFullAccess`
4. Select the `Entities attached` tab
5. For each attached entity:

- Select the entity
- Choose Detach

### Using AWS CLI

From Command Line (optional automation):

```bash
POLICY_ARN="arn:aws:iam::aws:policy/AWSCloudShellFullAccess"

# Detach from users
for u in $(aws iam list-entities-for-policy --policy-arn "$POLICY_ARN" --query "PolicyUsers[].UserName" --output text); do
  echo "Detaching from user: $u"
  aws iam detach-user-policy --user-name "$u" --policy-arn "$POLICY_ARN"
done

# Detach from roles
for r in $(aws iam list-entities-for-policy --policy-arn "$POLICY_ARN" --query "PolicyRoles[].RoleName" --output text); do
  echo "Detaching from role: $r"
  aws iam detach-role-policy --role-name "$r" --policy-arn "$POLICY_ARN"
done

# Detach from groups
for g in $(aws iam list-entities-for-policy --policy-arn "$POLICY_ARN" --query "PolicyGroups[].GroupName" --output text); do
  echo "Detaching from group: $g"
  aws iam detach-group-policy --group-name "$g" --policy-arn "$POLICY_ARN"
done
```

## Default Value

By default, the AWS managed policy `AWSCloudShellFullAccess` exists but is not attached to any users, groups, or roles. It must be explicitly assigned to grant permissions.

## References

1. https://docs.aws.amazon.com/cloudshell/latest/userguide/sec-auth-with-identities.html

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                     | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.1 Establish an Access Granting Process - Establish and follow a process, preferably automated, for granting access to enterprise assets upon new hire, rights grant, or role change of a user.                                            | x    | x    | x    |
| v7               | 14.1 Segment the Network Based on Sensitivity - Segment the network based on the label or classification level of the information stored on the servers, locate all sensitive information on separated Virtual Local Area Networks (VLANs). |      | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics                | Mitigations         |
| --------------------------- | ---------------------- | ------------------- |
| T1078.004                   | TA0009, TA0010, TA0043 | M1018, M1047, M1050 |

## Profile

Level 1 | Manual
