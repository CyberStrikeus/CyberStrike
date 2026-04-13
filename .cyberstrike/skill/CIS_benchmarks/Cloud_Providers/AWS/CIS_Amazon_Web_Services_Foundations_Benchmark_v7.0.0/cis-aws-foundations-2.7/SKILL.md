---
name: cis-aws-foundations-2.7
description: "Eliminate use of the 'root' user for administrative and daily tasks"
category: cis-iam
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, iam, root, least-privilege, credential-management]
cis_id: "2.7"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-2.4, cis-aws-foundations-2.5, cis-aws-foundations-2.6]
prerequisites: []
severity_boost: {}
---

# Eliminate use of the 'root' user for administrative and daily tasks

## Description

With the creation of an AWS account, a 'root user' is created that cannot be disabled or deleted. This user has unrestricted access to and control over all resources in the AWS account. It is highly recommended that the use of this account be avoided for everyday tasks.

## Rationale

The 'root user' has unrestricted access to and control over all account resources. Use of this account is inconsistent with the principles of least privilege and separation of duties and can lead to unnecessary harm due to user error or account compromise.

## Impact

Use of the root account for routine activities increases the risk of accidental or unauthorized changes, potentially resulting in full account compromise.

## Audit Procedure

### Using AWS Console

1. Sign in to the AWS Management Console and open the IAM console at https://console.aws.amazon.com/iam.
2. In the left pane, click `Credential Report`.
3. Select `Download Report`.
4. Open or Save the file locally.
5. Locate the `root` user under the user column.
6. Review:
   - `password_last_used`
   - `access_key_1_last_used_date`
   - `access_key_2_last_used_date`
7. Determine whether recent usage indicates frequent or inappropriate use of the root account.
8. Ensure the `mfa_active` field is set to `TRUE` or the `password_enabled` field is set to `FALSE`.

### Using AWS CLI

1. Run the following CLI commands to provide a credential report for determining the last time the 'root user' was used:

```bash
aws iam generate-credential-report
aws iam get-credential-report --query 'Content' --output text | base64 -d | cut -d, -f1,5,11,16 | grep -B1 '<root_account>'
```

2. Review:
   - `password_last_used`
   - `access_key_1_last_used_date`
   - `access_key_2_last_used_date`
3. Determine when the root user was last used.

**Note:** There are limited scenarios where use of the 'root' user is required. Refer to AWS documentation for a complete list.

## Expected Result

The root user should show no recent usage for administrative or daily tasks. `password_last_used`, `access_key_1_last_used_date`, and `access_key_2_last_used_date` should indicate infrequent or no recent use.

## Remediation

If the 'root' user account is being used for daily activities or administrative tasks that do not require root access:

### Using AWS Console

1. Stop using the root account for routine operations.
2. Create and use IAM roles or users with least privilege instead.
3. Change the root user password.
4. Deactivate or delete any access keys associated with the root user.

### Using AWS CLI

1. Run the following command as the root user in the account to delete the root login profile:

```bash
aws iam delete-login-profile
```

This removes the password associated with the root account and prevents console authentication using the root user.

## Default Value

By default, the AWS root user is created with full administrative privileges and no restrictions. The root account remains permanently enabled and can perform all actions unless access is limited through IAM users and roles.

## References

1. https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html
2. https://docs.aws.amazon.com/IAM/latest/UserGuide/id_root-user.html
3. https://docs.aws.amazon.com/general/latest/gr/aws_tasks-that-require-root.html

## Additional Information

- In AWS GovCloud environments, root access is linked to the associated standard AWS account and should be restricted and monitored in the same manner as commercial AWS accounts.
- Monitor root account usage using logging and alerting (e.g., CloudTrail and alerts for root activity).
- Monitoring usage of the 'root' user can be accomplished by implementing recommendation 3.3 - Ensure a log metric filter and alarm exist for usage of the 'root' user.

## CIS Controls

| Controls Version | Control                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | x    | x    | x    |
| v7               | 4.3 Ensure the Use of Dedicated Administrative Accounts                   | x    | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1078.004                   | TA0001, TA0004 | M1036       |

## Profile

Level 1 | Manual
