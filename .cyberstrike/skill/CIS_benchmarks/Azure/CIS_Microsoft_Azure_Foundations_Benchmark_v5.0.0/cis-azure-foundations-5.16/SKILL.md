---
name: cis-azure-foundations-5.16
description: "Ensure 'Guest invite restrictions' is set to 'Only users assigned to specific admin roles can invite guest users' or 'No one in the organization can invite guest users'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, guest-invitations, external-identities, access-control]
cis_id: "5.16"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.15]
prerequisites: []
severity_boost: {}
---

# Ensure 'Guest invite restrictions' is set to 'Only users assigned to specific admin roles can invite guest users' or 'No one in the organization can invite guest users'

## Description

Restrict invitations to either users with specific administrative roles or no one.

## Rationale

Restricting invitations to users with specific administrator roles ensures that only authorized accounts have access to cloud resources. This helps to maintain "Need to Know" permissions and prevents inadvertent access to data.

By default the setting `Guest invite restrictions` is set to `Anyone in the organization can invite guest users including guests and non-admins`. This would allow anyone within the organization to invite guests and non-admins to the tenant, posing a security risk.

## Impact

With the option of `Only users assigned to specific admin roles can invite guest users` selected, users with specific admin roles will be in charge of sending invitations to the external users, requiring additional overhead by them to manage user accounts. This will mean coordinating with other departments as they are onboarding new users.

## Audit Procedure

This setting has 4 levels of restriction:

- Anyone in the organization can invite guest users including guests and non-admins (most inclusive),
- Member users and users assigned to specific admin roles can invite guest users including guests with member permissions,
- Only users assigned to specific admin roles can invite guest users,
- No one in the organization can invite guest users including admins (most restrictive).

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `External Identities`
4. Select `External collaboration settings`
5. Under `Guest invite settings`, ensure that `Guest invite restrictions` is set to either `Only users assigned to specific admin roles can invite guest users` or `No one in the organization [...]`

### Using PowerShell

```powershell
Connect-MgGraph
(Get-MgPolicyAuthorizationPolicy).AllowInvitesFrom
```

If the resulting value is `adminsAndGuestInviters` or `none` the configuration complies.

## Expected Result

`Guest invite restrictions` should be set to `Only users assigned to specific admin roles can invite guest users` or `No one in the organization can invite guest users including admins`. PowerShell should return `adminsAndGuestInviters` or `none`.

## Remediation

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `External Identities`
4. Select `External collaboration settings`
5. Under `Guest invite settings`, set `Guest invite restrictions` to either `Only users assigned to specific admin roles can invite guest users` or `No one in the organization [...]`
6. Click `Save`

### Using PowerShell

```powershell
Connect-MgGraph
Update-MgPolicyAuthorizationPolicy -AllowInvitesFrom "adminsAndGuestInviters"
```

Alternatively, to set this to the most restrictive `No one in the organization [...]`:

```powershell
Connect-MgGraph
Update-MgPolicyAuthorizationPolicy -AllowInvitesFrom "none"
```

## Default Value

By default, `Guest invite restrictions` is set to `Anyone in the organization can invite guest users including guests and non-admins`.

## References

1. https://learn.microsoft.com/en-us/entra/external-id/external-collaboration-settings-configure
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-governance-strategy#gs-6-define-and-implement-identity-and-privileged-access-strategy
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-governance-strategy#gs-2-define-and-implement-enterprise-segmentationseparation-of-duties-strategy
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-privileged-access#pa-3-manage-lifecycle-of-identities-and-entitlements
5. https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.identity.signins/update-mgpolicyauthorizationpolicy?view=graph-powershell-1.0

## CIS Controls

| Controls Version | Control                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.1 Establish an Access Granting Process           | x    | x    | x    |
| v8               | 6.8 Define and Maintain Role-Based Access Control  |      |      | x    |
| v7               | 16.2 Configure Centralized Point of Authentication |      | x    | x    |

## Profile

Level 2 | Automated
