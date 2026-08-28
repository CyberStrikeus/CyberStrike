---
name: cis-azure-foundations-5.1.3
description: "Ensure 'Allow users to remember multifactor authentication on devices they trust' is disabled"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, mfa]
cis_id: "5.1.3"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.1.1, cis-azure-foundations-5.1.2]
prerequisites: []
severity_boost: {}
---

# Ensure 'Allow users to remember multifactor authentication on devices they trust' is disabled

## Description

[IMPORTANT - Please read the section overview: If your organization pays for Microsoft Entra ID licensing (included in Microsoft 365 E3, E5, F5, or Business Premium, and EM&S E3 or E5 licenses) and CAN use Conditional Access, ignore the recommendations in this section and proceed to the Conditional Access section.]

Do not allow users to remember multi-factor authentication on devices.

## Rationale

Remembering Multi-Factor Authentication (MFA) for devices and browsers allows users to have the option to bypass MFA for a set number of days after performing a successful sign-in using MFA. This can enhance usability by minimizing the number of times a user may need to perform two-step verification on the same device. However, if an account or device is compromised, remembering MFA for trusted devices may affect security. Hence, it is recommended that users not be allowed to bypass MFA.

## Impact

For every login attempt, the user will be required to perform multi-factor authentication.

## Audit Procedure

### Using Azure Portal

1. From Azure Home select the Portal Menu.
2. Select `Microsoft Entra ID`.
3. Under `Manage`, click `Users`.
4. Click the `Per-user MFA` button on the top bar.
5. Click on `Service settings`.
6. Ensure that `Allow users to remember multi-factor authentication on devices they trust` is not enabled.

## Expected Result

The `Allow users to remember multi-factor authentication on devices they trust` checkbox should be unchecked/disabled.

## Remediation

### Remediate from Azure Portal

1. From Azure Home select the Portal Menu.
2. Select `Microsoft Entra ID`.
3. Under `Manage`, click `Users`.
4. Click the `Per-user MFA` button on the top bar.
5. Click on `Service settings`.
6. Uncheck the box next to `Allow users to remember multi-factor authentication on devices they trust`.
7. Click `Save`.

## Default Value

By default, `Allow users to remember multi-factor authentication on devices they trust` is disabled.

## References

1. https://learn.microsoft.com/en-us/entra/identity/authentication/howto-mfa-mfasettings#remember-multi-factor-authentication-for-devices-that-users-trust
2. https://learn.microsoft.com/en-us/security/benchmark/azure/security-controls-v3-identity-management#im-4-use-strong-authentication-controls-for-all-azure-active-directory-based-access
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-identity-management#im-6-use-strong-authentication-controls

## CIS Controls

| Controls Version | Control                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.3 Require MFA for Externally-Exposed Applications |      | x    | x    |
| v8               | 6.4 Require MFA for Remote Network Access           | x    | x    | x    |
| v7               | 16.3 Require Multi-factor Authentication            |      | x    | x    |

## Profile

Level 1 | Manual
