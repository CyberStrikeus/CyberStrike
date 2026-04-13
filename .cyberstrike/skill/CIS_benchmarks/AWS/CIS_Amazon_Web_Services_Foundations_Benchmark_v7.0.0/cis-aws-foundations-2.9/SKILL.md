---
name: cis-aws-foundations-2.9
description: "Ensure IAM password policy prevents password reuse"
category: cis-iam
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, iam, password-policy, password-reuse, credential-management]
cis_id: "2.9"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-2.8]
prerequisites: []
severity_boost: {}
---

# Ensure IAM password policy prevents password reuse

## Description
IAM password policies can prevent the reuse of passwords by the same user. It is recommended that the password policy be configured to prevent password reuse.

## Rationale
Preventing password reuse increases account resilience against brute force and credential reuse attacks.

## Impact
Allowing password reuse increases the risk of account compromise, particularly if previously exposed or weak passwords are reused.

## Audit Procedure

### Using AWS Console
1. Sign in to the AWS Management Console and open the IAM console at https://console.aws.amazon.com/iam.
2. Click on `Account Settings` on the left Pane.
3. Ensure `Prevent password reuse` is checked.
4. Ensure `Remember XX password(s)` is set appropriately (e.g., 24 or greater).

### Using AWS CLI
1. Run the following command:

```bash
aws iam get-account-password-policy
```

2. Ensure the output includes:

```json
"PasswordReusePrevention": 24
```

## Expected Result
The IAM password policy has `PasswordReusePrevention` set to `24` or greater.

## Remediation

### Using AWS Console
1. Login to AWS Console (with appropriate permissions to View Identity Access Management Account Settings).
2. Go to `IAM Service`.
3. Select `Account Settings` on the left Pane.
4. Check `Prevent password reuse`.
5. Set `Remember XX password(s)` to **24 or greater**.

### Using AWS CLI
1. Run the following command:

```bash
aws iam update-account-password-policy --password-reuse-prevention 24
```

**Note:** All commands starting with "aws iam update-account-password-policy" can be combined into a single command.

## Default Value
By default, the AWS IAM password policy does not prevent password reuse. No password history is maintained unless explicitly configured.

## References
1. CCE-78908-1
2. https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_passwords_account-policy.html
3. https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html#configure-strong-password-policy

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 5.2 Use Unique Passwords | x | x | x |
| v7 | 4.4 Use Unique Passwords | | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1078.004 | TA0001, TA0007, TA0043 | M1027 |

## Profile
Level 1 | Automated
