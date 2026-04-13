---
name: cis-azure-foundations-5.15
description: "Ensure 'Guest users access restrictions' is set to 'Guest user access is restricted to properties and memberships of their own directory objects'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, guest-access, external-identities, least-privilege]
cis_id: "5.15"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.16]
prerequisites: []
severity_boost: {}
---

# Ensure 'Guest users access restrictions' is set to 'Guest user access is restricted to properties and memberships of their own directory objects'

## Description

Limit guest user permissions.

## Rationale

Limiting guest access ensures that guest accounts do not have permission for certain directory tasks, such as enumerating users, groups or other directory resources, and cannot be assigned to administrative roles in your directory. Guest access has three levels of restriction:

1. Guest users have the same access as members (most inclusive),
2. Guest users have limited access to properties and memberships of directory objects (default value),
3. Guest user access is restricted to properties and memberships of their own directory objects (most restrictive).

The recommended option is the 3rd, most restrictive: "Guest user access is restricted to their own directory object".

## Impact

This may create additional requests for permissions to access resources that administrators will need to approve. Some services (Forms, Project, Yammer, Planner in SharePoint) without current support might have compatibility issues with the new guest restriction setting.

## Audit Procedure

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `External Identities`
4. Select `External collaboration settings`
5. Under `Guest user access`, ensure that `Guest user access restrictions` is set to `Guest user access is restricted to properties and memberships of their own directory objects`

### Using PowerShell

```powershell
Connect-MgGraph
(Get-MgPolicyAuthorizationPolicy).GuestUserRoleId
```

If the `GuestUserRoleId` property does not equal `2af84b1e-32c8-42b7-82bc-daa82404023b` then it is not set to most restrictive.

## Expected Result

`Guest user access restrictions` should be set to `Guest user access is restricted to properties and memberships of their own directory objects`. The `GuestUserRoleId` should equal `2af84b1e-32c8-42b7-82bc-daa82404023b`.

## Remediation

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `External Identities`
4. Select `External collaboration settings`
5. Under `Guest user access`, set `Guest user access restrictions` to `Guest user access is restricted to properties and memberships of their own directory objects`
6. Click `Save`

### Using PowerShell

```powershell
Update-MgPolicyAuthorizationPolicy -GuestUserRoleId "2af84b1e-32c8-42b7-82bc-daa82404023b"
```

Verify by running:

```powershell
(Get-MgPolicyAuthorizationPolicy).GuestUserRoleId
```

Ensure that the GuestUserRoleId is equal to `2af84b1e-32c8-42b7-82bc-daa82404023b`.

## Default Value

By default, `Guest users access restrictions` is set to `Guest users have limited access to properties and memberships of directory objects`.

## References

1. https://learn.microsoft.com/en-us/entra/fundamentals/users-default-permissions#member-and-guest-users
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-privileged-access#pa-3-manage-lifecycle-of-identities-and-entitlements
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-governance-strategy#gs-2-define-and-implement-enterprise-segmentationseparation-of-duties-strategy
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-governance-strategy#gs-6-define-and-implement-identity-and-privileged-access-strategy
5. https://learn.microsoft.com/en-us/entra/identity/users/users-restrict-guest-permissions

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v8               | 6.8 Define and Maintain Role-Based Access Control     |      |      | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |

## Profile

Level 1 | Automated
