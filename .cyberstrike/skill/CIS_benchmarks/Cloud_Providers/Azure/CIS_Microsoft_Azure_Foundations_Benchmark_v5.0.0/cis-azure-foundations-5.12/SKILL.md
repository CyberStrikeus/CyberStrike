---
name: cis-azure-foundations-5.12
description: "Ensure 'User consent for applications' is set to 'Do not allow user consent'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, application-consent, enterprise-apps, permissions]
cis_id: "5.12"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.13, cis-azure-foundations-5.14]
prerequisites: []
severity_boost: {}
---

# Ensure 'User consent for applications' is set to 'Do not allow user consent'

## Description

Require administrators to provide consent for applications before use.

## Rationale

If Microsoft Entra ID is running as an identity provider for third-party applications, permissions and consent should be limited to administrators or pre-approved. Malicious applications may attempt to exfiltrate data or abuse privileged user accounts.

## Impact

Enforcing this setting may create additional requests that administrators need to review.

## Audit Procedure

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `Enterprise applications`
4. Under `Security`, select `Consent and permissions`
5. Under `Manage`, select `User consent settings`
6. Ensure `User consent for applications` is set to `Do not allow user consent`

### Using PowerShell

```powershell
Connect-MgGraph
(Get-MgPolicyAuthorizationPolicy).DefaultUserRolePermissions | Select-Object -ExpandProperty PermissionGrantPoliciesAssigned
```

If the command returns no values in response, the configuration complies with the recommendation.

## Expected Result

`User consent for applications` should be set to `Do not allow user consent`. The PowerShell command should return no values.

## Remediation

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `Enterprise applications`
4. Under `Security`, select `Consent and permissions`
5. Under `Manage`, select `User consent settings`
6. Set `User consent for applications` to `Do not allow user consent`
7. Click `Save`

## Default Value

By default, `Users consent for applications` is set to `Allow user consent for apps`.

## References

1. https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent?pivots=ms-powershell#configure-user-consent-to-applications
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-privileged-access#pa-1-separate-and-limit-highly-privilegedadministrative-users
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-governance-strategy#gs-2-define-and-implement-enterprise-segmentationseparation-of-duties-strategy
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-governance-strategy#gs-6-define-and-implement-identity-and-privileged-access-strategy

## CIS Controls

| Controls Version | Control                                  | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------- | ---- | ---- | ---- |
| v8               | 2.3 Address Unauthorized Software        | x    | x    | x    |
| v8               | 6.1 Establish an Access Granting Process | x    | x    | x    |
| v7               | 2.6 Address unapproved software          | x    | x    | x    |

## Profile

Level 1 | Manual
