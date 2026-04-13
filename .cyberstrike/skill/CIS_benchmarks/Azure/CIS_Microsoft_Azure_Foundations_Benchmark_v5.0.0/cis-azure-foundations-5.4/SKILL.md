---
name: cis-azure-foundations-5.4
description: "Ensure 'Restrict non-admin users from creating tenants' is set to 'Yes'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, entra-id, tenant-creation, access-control]
cis_id: "5.4"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.14, cis-azure-foundations-5.17]
prerequisites: []
severity_boost: {}
---

# Ensure 'Restrict non-admin users from creating tenants' is set to 'Yes'

## Description

Require administrators or appropriately delegated users to create new tenants.

## Rationale

It is recommended to only allow an administrator to create new tenants. This prevents users from creating new Microsoft Entra ID or Azure AD B2C tenants and ensures that only authorized users are able to do so.

## Impact

Enforcing this setting will ensure that only authorized users are able to create new tenants.

## Audit Procedure

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `Users`
4. Under `Manage`, select `User settings`
5. Ensure that `Restrict non-admin users from creating tenants` is set to `Yes`

### Using PowerShell

```powershell
Import-Module Microsoft.Graph.Identity.SignIns
Connect-MgGraph -Scopes 'Policy.ReadWrite.Authorization'
Get-MgPolicyAuthorizationPolicy | Select-Object -ExpandProperty DefaultUserRolePermissions | Format-List
```

Review the "DefaultUserRolePermissions" section of the output. Ensure that `AllowedToCreateTenants` is not `True`.

## Expected Result

In the Azure Portal, `Restrict non-admin users from creating tenants` should be set to `Yes`. In PowerShell, `AllowedToCreateTenants` should be `False`.

## Remediation

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `Users`
4. Under `Manage`, select `User settings`
5. Set `Restrict non-admin users from creating tenants` to `Yes`
6. Click `Save`

### Using PowerShell

```powershell
Import-Module Microsoft.Graph.Identity.SignIns

Connect-MgGraph -Scopes 'Policy.ReadWrite.Authorization'

Select-MgProfile -Name beta

$params = @{
DefaultUserRolePermissions = @{
AllowedToCreateTenants = $false
}
}

Update-MgPolicyAuthorizationPolicy -AuthorizationPolicyId -BodyParameter $params
```

## Default Value

By default, users can create tenants.

## References

1. https://learn.microsoft.com/en-us/entra/fundamentals/users-default-permissions
2. https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/permissions-reference#tenant-creator
3. https://blog.admindroid.com/disable-users-creating-new-azure-ad-tenants-in-microsoft-365/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 6.8 Define and Maintain Role-Based Access Control | | | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |

## Profile

Level 1 | Automated
