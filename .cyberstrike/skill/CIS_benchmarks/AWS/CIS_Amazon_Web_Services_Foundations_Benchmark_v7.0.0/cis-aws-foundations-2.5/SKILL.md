---
name: cis-aws-foundations-2.5
description: "Ensure MFA is enabled for the 'root' user account"
category: cis-iam
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, iam, root, mfa, authentication]
cis_id: "2.5"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-2.4, cis-aws-foundations-2.6, cis-aws-foundations-2.7, cis-aws-foundations-2.10]
prerequisites: []
severity_boost: {}
---

# Ensure MFA is enabled for the 'root' user account

## Description
The 'root' user account is the most privileged user in an AWS account. Multi-Factor Authentication (MFA) adds an extra layer of protection on top of a username and password. With MFA enabled, when a user signs in to an AWS website, they are prompted for their username and password as well as an authentication code from their MFA device.

**Note:** When virtual MFA is used for 'root' accounts, it is recommended that the device used is not a personal device, but rather a dedicated mobile device (tablet or phone) that is kept charged and secured, independent of any individual ("non-personal virtual MFA"). This reduces the risk of losing access to MFA due to device loss, device replacement, or employee turnover.

Where an AWS Organization is using centralized root access, root credentials can be removed from member accounts. In that case, it is neither possible nor necessary to configure root MFA in the member account.

## Rationale
Enabling MFA increases security for console access by requiring the authenticating principal to possess a device that generates a time-sensitive authentication code, in addition to their credentials.

## Impact
Without MFA, the root account is highly susceptible to compromise, potentially resulting in full account takeover and unrestricted access to all resources.

## Audit Procedure

### Using AWS Console
1. Sign in to the AWS Management Console and open the IAM console at https://console.aws.amazon.com/iam.
2. Click on `Credential Report`.
3. Download the `.csv` file containing credential usage for all IAM users within an AWS Account.
4. Open this file.
5. For the `root` user, ensure:
   - `mfa_active` is set to `TRUE`, or
   - `password_enabled` is set to `FALSE`

### Using AWS CLI
1. Run the following command:

```bash
aws iam get-account-summary | grep "AccountMFAEnabled"
aws iam get-account-summary | grep "AccountPasswordPresent"
```

2. Ensure:
   - `AccountMFAEnabled` property is set to 1, or
   - `AccountPasswordPresent` property is set to 0

## Expected Result
`AccountMFAEnabled` is set to `1` (MFA enabled) or `AccountPasswordPresent` is set to `0` (console access removed).

## Remediation

**Note:** To manage MFA devices for the 'root' AWS account, you must use root credentials. MFA cannot be managed for the root account using IAM users or roles.

### Using AWS Console
1. Sign in to the AWS Management Console using the root user email.
2. In the top right corner, click the account name.
3. Choose `Security Credentials`.
4. Under `Multi-Factor authentication (MFA)`, locate the root user.
5. Choose `Assign MFA device` (or Activate MFA, depending on UI version).
6. Select `Virtual MFA device`.
7. Choose one of the following:
   - Scan the QR code using your MFA app, or
   - Select Show secret key for manual configuration and enter it into your MFA app.
8. Enter the first authentication code in Authentication Code 1.
9. Wait for a new code, then enter it in Authentication Code 2.
10. Click `Assign Virtual MFA`.

## Default Value
By default, the AWS root user does not have Multi-Factor Authentication (MFA) enabled. MFA must be explicitly configured after account creation.

## References
1. CCE-78911-5
2. https://docs.aws.amazon.com/IAM/latest/UserGuide/id_root-user.html#id_root-user_manage_mfa
3. https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_mfa_enable_virtual.html#enable-virt-mfa-for-root
4. https://docs.aws.amazon.com/IAM/latest/UserGuide/id_root-enable-root-access.html

## Additional Information
- In AWS GovCloud environments, root access is linked to the associated standard AWS account and should be restricted and monitored in the same manner as commercial AWS accounts.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 6.5 Require MFA for Administrative Access | x | x | x |
| v7 | 4.5 Use Multifactor Authentication For All Administrative Access | | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1078.004 | TA0001, TA0004 | M1032 |

## Profile
Level 1 | Automated
