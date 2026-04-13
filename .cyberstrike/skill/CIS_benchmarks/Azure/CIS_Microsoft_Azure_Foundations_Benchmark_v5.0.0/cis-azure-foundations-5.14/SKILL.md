---
name: cis-azure-foundations-5.14
description: "Ensure 'Users can register applications' is set to 'No'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, application-registration, access-control, least-privilege]
cis_id: "5.14"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.12, cis-azure-foundations-5.4]
prerequisites: []
severity_boost: {}
---

# Ensure 'Users can register applications' is set to 'No'

## Description

Require administrators or appropriately delegated users to register third-party applications.

## Rationale

It is recommended to only allow an administrator to register custom-developed applications. This ensures that the application undergoes a formal security review and approval process prior to exposing Microsoft Entra ID data. Certain users like developers or other high-request users may also be delegated permissions to prevent them from waiting on an administrative user. Your organization should review your policies and decide your needs.

## Impact

Enforcing this setting will create additional requests for approval that will need to be addressed by an administrator. If permissions are delegated, a user may approve a malevolent third party application, potentially giving it access to your data.

## Audit Procedure

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `Users`
4. Under `Manage`, select `User settings`
5. Ensure that `Users can register applications` is set to `No`

### Using PowerShell

```powershell
(Get-MgPolicyAuthorizationPolicy).DefaultUserRolePermissions | Format-List AllowedToCreateApps
```

Command should return the value of `False`.

## Expected Result

`Users can register applications` should be set to `No`. PowerShell should return `AllowedToCreateApps: False`.

## Remediation

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `Users`
4. Under `Manage`, select `User settings`
5. Set `Users can register applications` to `No`
6. Click `Save`

### Using PowerShell

```powershell
$param = @{ AllowedToCreateApps = "$false" }
Update-MgPolicyAuthorizationPolicy -DefaultUserRolePermissions $param
```

## Default Value

By default, `Users can register applications` is set to "Yes".

## References

1. https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/delegate-app-roles#restrict-who-can-create-applications
2. https://learn.microsoft.com/en-us/entra/identity-platform/how-applications-are-added#who-has-permission-to-add-applications-to-my-azure-ad-instance
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-governance-strategy#gs-6-define-and-implement-identity-and-privileged-access-strategy
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-privileged-access#pa-1-separate-and-limit-highly-privilegedadministrative-users
5. https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.identity.signins/get-mgpolicyauthorizationpolicy?view=graph-powershell-1.0

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 2.3 Address Unauthorized Software | x | x | x |
| v8 | 2.4 Utilize Automated Software Inventory Tools | | x | x |
| v8 | 6.7 Centralize Access Control | | x | x |
| v7 | 2.6 Address unapproved software | x | x | x |

## Profile

Level 1 | Automated
