---
name: cis-azure-foundations-5.22
description: "Ensure 'Require Multifactor Authentication to register or join devices with Microsoft Entra' is set to 'Yes'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, mfa, device-registration, entra-id]
cis_id: "5.22"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.5]
prerequisites: []
severity_boost: {}
---

# Ensure 'Require Multifactor Authentication to register or join devices with Microsoft Entra' is set to 'Yes'

## Description

**NOTE:** This recommendation is only relevant if your subscription is using Per-User MFA. If your organization is licensed to use Conditional Access, the preferred method of requiring MFA to join devices to Entra ID is to use a Conditional Access policy (see additional information below for link).

Joining or registering devices to Microsoft Entra ID should require multi-factor authentication.

## Rationale

Multi-factor authentication is recommended when adding devices to Microsoft Entra ID. When set to `Yes`, users who are adding devices from the internet must first use the second method of authentication before their device is successfully added to the directory. This ensures that rogue devices are not added to the domain using a compromised user account.

## Impact

A slight impact of additional overhead, as Administrators will now have to approve every access to the domain.

## Audit Procedure

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `Devices`
4. Under `Manage`, select `Device settings`
5. Under `Microsoft Entra join and registration settings`, ensure that `Require Multifactor Authentication to register or join devices with Microsoft Entra` is set to `Yes`

## Expected Result

`Require Multifactor Authentication to register or join devices with Microsoft Entra` should be set to `Yes`.

## Remediation

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `Devices`
4. Under `Manage`, select `Device settings`
5. Under `Microsoft Entra join and registration settings`, set `Require Multifactor Authentication to register or join devices with Microsoft Entra` to `Yes`
6. Click `Save`

## Default Value

By default, `Require Multifactor Authentication to register or join devices with Microsoft Entra` is set to `No`.

## References

1. https://learn.microsoft.com/en-us/entra/identity/conditional-access/policy-all-users-device-registration
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-identity-management#im-6-use-strong-authentication-controls

## CIS Controls

| Controls Version | Control                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.3 Require MFA for Externally-Exposed Applications |      | x    | x    |
| v8               | 6.4 Require MFA for Remote Network Access           | x    | x    | x    |
| v7               | 16.3 Require Multi-factor Authentication            |      | x    | x    |

## Profile

Level 1 | Manual
