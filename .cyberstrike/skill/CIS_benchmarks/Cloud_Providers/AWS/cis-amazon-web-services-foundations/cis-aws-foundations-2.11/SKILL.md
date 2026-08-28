---
name: cis-aws-foundations-2.11
description: "Ensure credentials unused for 45 days or more are disabled"
category: cis-iam
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, iam, credentials, unused-credentials, access-keys, password]
cis_id: "2.11"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-2.12, cis-aws-foundations-2.10]
prerequisites: []
severity_boost: {}
---

# Ensure credentials unused for 45 days or more are disabled

## Description

AWS IAM users can access AWS resources using different types of credentials, such as passwords or access keys. It is recommended that all credentials that have been unused for 45 days or more be deactivated or removed.

## Rationale

Disabling or removing unused credentials reduces the window of opportunity for credentials associated with a compromised or abandoned account to be used.

## Impact

Disabling or removing unused credentials reduces the window of opportunity for credentials associated with a compromised or abandoned account to be used.

## Audit Procedure

### Using AWS Console

1. Sign in to the AWS Management Console and open the IAM console at https://console.aws.amazon.com/iam
2. Click on `Users`
3. Click the `Settings` (gear) icon
4. Select `Console last sign-in`, `Access key last used`, and `Access Key Id`
5. Click on `Confirm`
6. Check and ensure that `Console last sign-in` is less than 45 days ago.

**Note** - `-` means the user has never logged in.

7. If credentials have not been used within 45 days, refer to remediation

### Using AWS CLI

1. Generate and review the credential report:

```bash
aws iam generate-credential-report
aws iam get-credential-report --query 'Content' --output text | base64 -d
```

2. Review the following fields:

- `password_last_used`
- `access_key_1_last_used_date`
- `access_key_2_last_used_date`

3. Identify any credentials unused for 45 days or more

## Expected Result

All IAM user credentials (passwords and access keys) should show activity within the last 45 days. Any credentials unused for 45 days or more should be disabled or removed.

## Remediation

### Using AWS Console

Perform the following to deactivate or remove unused credentials:

1. Login to the AWS Management Console and open the IAM console
2. Click on the `User`
3. Select the user
4. Click `Security Credentials`

Disable Console Access:

5. In the Console sign-in section, select Manage console access
6. If Console last sign-in is greater than 45 days, select Disable access

Deactivate or Delete Access Keys:

7. In the Access keys section:

- Deactivate unused keys, or
- Delete keys that are no longer required

### Using AWS CLI

1. Delete unused access keys:

```bash
aws iam delete-access-key --access-key-id <access-key-id> --user-name <user-name>
```

2. Remove console access:

```bash
aws iam delete-login-profile --user-name <user-name>
```

## Default Value

By default, AWS does not automatically disable or remove IAM user credentials based on age or last use. Console passwords and access keys remain active until manually deactivated or deleted.

## References

1. CCE-78900-8
2. https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html#remove-credentials
3. https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_finding_unused.html
4. https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_passwords_admin-change-user.html
5. https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html

## Additional Information

- `<root_account>` is excluded from this audit, as root usage should be limited and may not occur within a 45-day window
- Consider implementing automation (e.g., AWS Config, Lambda, or IAM Access Analyzer) to regularly detect and remediate unused credentials

## CIS Controls

| Controls Version | Control                                                                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.3 Disable Dormant Accounts - Delete or disable any dormant accounts after a period of 45 days of inactivity, where supported. | x    | x    | x    |
| v7               | 16.9 Disable Dormant Accounts - Automatically disable dormant accounts after a set period of inactivity.                        | x    | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1078.004                   | TA0001  | M1018       |

## Profile

Level 1 | Automated
