---
name: cis-aws-foundations-2.10
description: "Ensure multi-factor authentication (MFA) is enabled for all IAM users that have a console password"
category: cis-iam
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, iam, mfa, console-password, authentication, users]
cis_id: "2.10"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-2.5, cis-aws-foundations-2.6]
prerequisites: []
severity_boost: {}
---

# Ensure multi-factor authentication (MFA) is enabled for all IAM users that have a console password

## Description

Multi-Factor Authentication (MFA) adds an extra layer of authentication assurance beyond traditional credentials. With MFA enabled, when a user signs in to the AWS Console, they are prompted for their username and password as well as an authentication code from their physical or virtual MFA device. It is recommended that MFA be enabled for all IAM users that have a console password.

## Rationale

Enabling MFA increases security for console access by requiring the authenticating principal to possess a device that generates a time-sensitive authentication code, in addition to their credentials.

## Impact

Without MFA, IAM user accounts with console access are more susceptible to credential compromise, potentially leading to unauthorized access to AWS resources.

## Audit Procedure

### Using AWS Console

1. Sign in to the AWS Management Console and open the IAM console at https://console.aws.amazon.com/iam.
2. In the left pane, select `Users`.
3. If the `MFA` or `Password age` columns are not visible, click the gear icon in the upper right corner and enable them.
4. Ensure that for each user where the `Password age` column shows a value, the `MFA` column shows `Virtual`, `U2F Security Key`, or `Hardware`.

### Using AWS CLI

1. Run the following command:

```bash
aws iam generate-credential-report
aws iam get-credential-report --query 'Content' --output text | base64 -d | cut -d, -f1,4,8
```

2. The output of this command will produce a table similar to the following:

```
user,password_enabled,mfa_active
elise,false,false
brandon,true,true
rakesh,false,false
helene,false,false
paras,true,true
anitha,false,false
```

3. For any column having `password_enabled` set to `true`, ensure `mfa_active` is also set to `true`.

## Expected Result

All IAM users with `password_enabled` set to `true` also have `mfa_active` set to `true`.

## Remediation

### Using AWS Console

1. Sign in to the AWS Management Console and open the IAM console at https://console.aws.amazon.com/iam/.
2. In the left pane, select `Users`.
3. Select the IAM user.
4. Choose the `Security credentials` tab.
5. Under `Multi-factor authentication (MFA)`, select `Assign MFA device`.
6. Select `Virtual MFA device` (or hardware/security key as applicable), then choose `Continue`.
7. Configure the MFA device by:
   - Scanning the QR code, or
   - Entering the secret key manually.
8. Enter two consecutive authentication codes.
9. Select `Assign MFA`.

## Default Value

By default, IAM users with a console password do not have MFA enabled. MFA must be explicitly configured for each user account.

## References

1. https://tools.ietf.org/html/rfc6238
2. https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_mfa.html
3. https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html#enable-mfa-for-privileged-users
4. https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_mfa_enable_virtual.html
5. CCE-78901-6
6. https://blogs.aws.amazon.com/security/post/Tx2SJJYE082KBUK/How-to-Delegate-Management-of-Multi-Factor-Authentication-to-AWS-IAM-Users

## Additional Information

### Forced IAM User Self-Service Remediation

Amazon has published a pattern that requires users to set up MFA through self-service before they gain access to their complete set of permissions. Until they complete this step, they cannot access their full permissions. This pattern can be used for new AWS accounts. It can also be applied to existing accounts; it is recommended that users receive instructions and a grace period to complete MFA enrollment before active enforcement on existing AWS accounts.

## CIS Controls

| Controls Version | Control                                                          | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.5 Require MFA for Administrative Access                        | x    | x    | x    |
| v7               | 4.5 Use Multifactor Authentication For All Administrative Access |      | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics                | Mitigations |
| --------------------------- | ---------------------- | ----------- |
| T1078.004                   | TA0001, TA0007, TA0043 | M1027       |

## Profile

Level 1 | Automated
