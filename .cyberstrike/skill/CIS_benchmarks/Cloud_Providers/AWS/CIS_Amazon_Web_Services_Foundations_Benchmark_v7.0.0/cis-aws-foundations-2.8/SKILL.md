---
name: cis-aws-foundations-2.8
description: "Ensure IAM password policy requires minimum length of 14 or greater"
category: cis-iam
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, iam, password-policy, minimum-length, brute-force]
cis_id: "2.8"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-2.9]
prerequisites: []
severity_boost: {}
---

# Ensure IAM password policy requires minimum length of 14 or greater

## Description

Password policies are used, in part, to enforce password complexity requirements. IAM password policies can ensure that passwords meet a minimum length. It is recommended that the password policy require a minimum password length of 14 characters.

## Rationale

Setting a password policy with sufficient length requirements increases account resilience against brute force login attempts.

## Impact

Enforcing a minimum password length of 14 characters enhances security by making passwords more resistant to brute force attacks. However, it may require users to create longer passwords, which could impact user convenience.

## Audit Procedure

### Using AWS Console

1. Sign in to the AWS Management Console and open the IAM console at https://console.aws.amazon.com/iam.
2. Select `Account Settings` on the left Pane.
3. Located the 'Password Policy' section.
4. Ensure "Minimum password length" is set to 14 or greater.

### Using AWS CLI

1. Run the following command:

```bash
aws iam get-account-password-policy
```

2. Ensure the output includes:

```json
"MinimumPasswordLength": 14
```

(or higher)

## Expected Result

The IAM password policy has `MinimumPasswordLength` set to `14` or greater.

## Remediation

### Using AWS Console

1. Login to AWS Console (with appropriate permissions to View Identity Access Management Account Settings).
2. Go to IAM Service.
3. Select `Account Settings` on the Left Pane.
4. Set "Minimum password length" to `14` or greater.
5. Select "Apply password policy".

### Using AWS CLI

1. Run the following command:

```bash
aws iam update-account-password-policy --minimum-password-length 14
```

**Note:** All commands starting with "aws iam update-account-password-policy" can be combined into a single command.

## Additional Information

Ensure the password policy also includes requirements for password complexity, such as uppercase letters, lowercase letters, numbers, and special characters:

```bash
aws iam update-account-password-policy \
  --require-uppercase-characters \
  --require-lowercase-characters \
  --require-numbers \
  --require-symbols
```

## Default Value

By default, the AWS IAM account password policy does not enforce a minimum password length. If configured, the default minimum length is 6 characters.

## References

1. CCE-78907-3
2. https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_passwords_account-policy.html
3. https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html#configure-strong-password-policy

## CIS Controls

| Controls Version | Control                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.2 Use Unique Passwords                             | x    | x    | x    |
| v7               | 16.1 Maintain an Inventory of Authentication Systems |      | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics                | Mitigations |
| --------------------------- | ---------------------- | ----------- |
| T1078.004                   | TA0001, TA0007, TA0043 | M1027       |

## Profile

Level 1 | Automated
