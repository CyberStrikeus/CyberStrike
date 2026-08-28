---
name: cis-azure-foundations-5.24
description: "Ensure a custom role is assigned permissions for administering resource locks"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, rbac, resource-locks, custom-roles, nist]
cis_id: "5.24"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.23]
prerequisites: []
severity_boost: {}
---

# Ensure a custom role is assigned permissions for administering resource locks

## Description

Resource locking is a powerful protection mechanism that can prevent inadvertent modification or deletion of resources within Azure subscriptions and resource groups, and it is a recommended NIST configuration.

## Rationale

Given that the resource lock functionality is outside of standard Role-Based Access Control (RBAC), it would be prudent to create a resource lock administrator role to prevent inadvertent unlocking of resources.

## Impact

By adding this role, specific permissions may be granted for managing only resource locks rather than needing to provide the broad Owner or User Access Administrator role, reducing the risk of the user being able to cause unintentional damage.

## Audit Procedure

### Using Azure Portal

1. In the Azure portal, navigate to a subscription or resource group.
2. Click `Access control (IAM)`.
3. Click `Roles`.
4. Click `Type : All`.
5. Click to view the drop-down menu.
6. Select `Custom role`.
7. Click `View` in the `Details` column of a custom role.
8. Review the role permissions.
9. Click `Assignments` and review the assignments.
10. Click the `X` to exit the custom role details page.
11. Repeat steps 7-10. Ensure that at least one custom role exists that assigns the `Microsoft.Authorization/locks` permission to appropriate members.
12. Repeat steps 1-11 for each subscription or resource group.

## Expected Result

At least one custom role should exist that assigns the `Microsoft.Authorization/locks` permission to appropriate members.

## Remediation

### Using Azure Portal

1. In the Azure portal, navigate to a subscription or resource group.
2. Click `Access control (IAM)`.
3. Click `+ Add`.
4. Click `Add custom role`.
5. In the `Custom role name` field enter `Resource Lock Administrator`.
6. In the `Description` field enter `Can Administer Resource Locks`.
7. For `Baseline permissions` select `Start from scratch`.
8. Click `Next`.
9. Click `Add permissions`.
10. In the `Search for a permission` box, type `Microsoft.Authorization/locks`.
11. Click the result.
12. Check the box next to `Permission`.
13. Click `Add`.
14. Click `Review + create`.
15. Click `Create`.
16. Click `OK`.
17. Click `+ Add`.
18. Click `Add role assignment`.
19. In the `Search by role name, description, permission, or ID` box, type `Resource Lock Administrator`.
20. Select the role.
21. Click `Next`.
22. Click `+ Select members`.
23. Select appropriate members.
24. Click `Select`.
25. Click `Review + assign`.
26. Click `Review + assign` again.
27. Repeat steps 1-26 for each subscription or resource group requiring remediation.

### Using PowerShell

```powershell
Import-Module Az.Accounts
Connect-AzAccount

$role = Get-AzRoleDefinition "User Access Administrator"
$role.Id = $null
$role.Name = "Resource Lock Administrator"
$role.Description = "Can Administer Resource Locks"
$role.Actions.Clear()
$role.Actions.Add("Microsoft.Authorization/locks/*")
$role.AssignableScopes.Clear()

# Scope at the Management group level Management group
$role.AssignableScopes.Add("/providers/Microsoft.Management/managementGroups/MG-Name")

New-AzRoleDefinition -Role $role
Get-AzureRmRoleDefinition "Resource Lock Administrator"
```

## Default Value

A role for administering resource locks does not exist by default.

## References

1. https://learn.microsoft.com/en-us/azure/role-based-access-control/custom-roles
2. https://learn.microsoft.com/en-us/azure/role-based-access-control/check-access
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-privileged-access#pa-1-separate-and-limit-highly-privilegedadministrative-users
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-privileged-access#pa-7-follow-just-enough-administration-least-privilege-principle
5. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-privileged-access#pa-3-manage-lifecycle-of-identities-and-entitlements
6. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-governance-strategy#gs-2-define-and-implement-enterprise-segmentationseparation-of-duties-strategy
7. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-governance-strategy#gs-6-define-and-implement-identity-and-privileged-access-strategy

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v8               | 6.8 Define and Maintain Role-Based Access Control     |      |      | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |

## Profile

Level 2 | Manual
