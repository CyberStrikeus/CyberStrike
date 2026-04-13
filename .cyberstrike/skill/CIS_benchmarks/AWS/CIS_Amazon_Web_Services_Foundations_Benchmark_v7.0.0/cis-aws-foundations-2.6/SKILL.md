---
name: cis-aws-foundations-2.6
description: "Ensure hardware MFA is enabled for the 'root' user account"
category: cis-iam
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, iam, root, mfa, hardware-mfa, authentication]
cis_id: "2.6"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-2.4, cis-aws-foundations-2.5, cis-aws-foundations-2.7]
prerequisites: []
severity_boost: {}
---

# Ensure hardware MFA is enabled for the 'root' user account

## Description
The 'root' user account is the most privileged user in an AWS account. MFA adds an extra layer of protection on top of a username and password. With MFA enabled, when a user signs in to an AWS website, they are prompted for their username and password as well as an authentication code from their MFA device. For Level 2, it is recommended that the 'root' user account be protected with a hardware MFA device.

Where an AWS Organization is using centralized root access, root credentials can be removed from member accounts. In that case, it is neither possible nor necessary to configure root MFA in the member account.

## Rationale
A hardware MFA device has a smaller attack surface than a virtual MFA. For example, a hardware MFA device does not inherit the risks associated with mobile devices on which virtual MFA applications reside.

**Note:** Using hardware MFA for numerous AWS accounts may create logistical device management challenges. In such cases, consider applying this Level 2 recommendation selectively to the highest-security AWS accounts, while applying the Level 1 recommendation to others.

## Impact
Without hardware MFA, root account protection may be more susceptible to compromise compared to hardware-based authentication, increasing the risk of unauthorized access.

## Audit Procedure

### Using AWS CLI
1. Run the following commands to determine if the 'root' account has MFA enabled:

```bash
aws iam get-account-summary | grep "AccountMFAEnabled"
aws iam get-account-summary | grep "AccountPasswordPresent"
```

2. Verify:
   - `AccountMFAEnabled` is set to `1` (MFA enabled)
   - `AccountPasswordPresent` is set to `1` (console access exists) or `0` (console access removed)

3. If `AccountMFAEnabled` is set to `1` (MFA enabled), determine whether the MFA device is hardware:

```bash
aws iam list-virtual-mfa-devices
```

4. If the output contains a serial number similar to:

```
"SerialNumber": "arn:aws:iam::<aws_account_number>:mfa/root-account-mfa-device"
```

then the MFA device is virtual, not hardware, and the account is **not compliant** with this recommendation.

## Expected Result
MFA is enabled for the root account and the MFA device is hardware-based (not listed in `list-virtual-mfa-devices` output).

## Remediation

### Using AWS Console
1. Sign in to the AWS Management Console using the root account.
2. Click on <root_account> at the top right and select `Security Credentials` from the drop-down list.
3. Under `Multi-Factor Authentication (MFA)`, locate the root user.
4. If a virtual MFA device is already assigned, remove it before proceeding.
5. Click `Assign MFA device` (or `Manage MFA`, depending on UI version).
6. Select `Security key` or `hardware MFA device`.
7. Enter the required device details (e.g., serial number or follow prompts for security key).
8. Enter authentication codes if required.
9. Click `Assign MFA`.

## Default Value
By default, the AWS root user does not have a hardware MFA device assigned. MFA must be explicitly configured, and if enabled by default it will be virtual (software-based), not hardware.

## References
1. CCE-78911-5
2. https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_mfa_enable_virtual.html
3. https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_mfa_enable_physical.html#enable-hw-mfa-for-root
4. https://docs.aws.amazon.com/IAM/latest/UserGuide/id_root-enable-root-access.html
5. https://docs.aws.amazon.com/IAM/latest/UserGuide/enable-virt-mfa-for-root.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 6.5 Require MFA for Administrative Access | x | x | x |
| v7 | 4.5 Use Multifactor Authentication For All Administrative Access | | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1078.004 | TA0004 | M1032 |

## Profile
Level 2 | Manual
