---
name: cis-azure-foundations-5.3.5
description: "Ensure disabled user accounts do not have read, write, or owner permissions"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, identity-reviews]
cis_id: "5.3.5"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.3.4, cis-azure-foundations-5.3.6]
prerequisites: []
severity_boost: {}
---

# Ensure disabled user accounts do not have read, write, or owner permissions

## Description

Ensure that any roles granting read, write, or owner permissions are removed from disabled Azure user accounts.

While an automated assessment procedure exists for this recommendation, the assessment status remains manual. Removing role assignments from disabled user accounts depends on the context and requirements of each organization and environment.

## Rationale

Disabled accounts should not retain access to resources, as this poses a security risk. Removing role assignments mitigates potential unauthorized access and enforces the principle of least privilege.

## Impact

Ensure disabled accounts are not relied on for break glass or automated processes before removing roles to avoid service disruption.

## Audit Procedure

### Using Azure Portal

1. Go to `Microsoft Entra ID`.
2. Under `Manage`, click `Users`.
3. Click `Add filter`.
4. Click `Account enabled`.
5. Click the toggle switch to set the value to `No`.
6. Click `Apply`.
7. Click the `Display name` of a disabled user account.
8. Click `Azure role assignments`.
9. Ensure that no read, write, or owner roles are assigned to the user account.
10. Repeat steps 7-9 for each disabled user account.

### Using PowerShell

```powershell
Connect-AzureAD
Get-AzureADUser
```

Run the following command to get a user:

```powershell
$user = Get-AzureADUser -ObjectId <object-id>
```

Run the following command to get the `AccountEnabled` setting for the user:

```powershell
$user.AccountEnabled
```

If `AccountEnabled` is `False`, run the following command to get the role assignments for the user:

```powershell
Get-AzRoleAssignment -ObjectId $user.ObjectId
```

Ensure that no read, write, or owner roles are assigned to the user. Repeat for each user.

### Using Azure Policy

- **Policy ID:** 0cfea604-3201-4e14-88fc-fae4c427a6c5 - **Name:** 'Blocked accounts with owner permissions on Azure resources should be removed'
- **Policy ID:** 8d7e1fde-fe26-4b5f-8108-f8e432cbc2be - **Name:** 'Blocked accounts with read and write permissions on Azure resources should be removed'

## Expected Result

No disabled user accounts should have any read, write, or owner role assignments. The PowerShell command `Get-AzRoleAssignment` should return no results for disabled accounts.

## Remediation

### Remediate from Azure Portal

1. Go to `Microsoft Entra ID`.
2. Under `Manage`, click `Users`.
3. Click `Add filter`.
4. Click `Account enabled`.
5. Click the toggle switch to set the value to `No`.
6. Click `Apply`.
7. Click the `Display name` of a disabled user account with read, write, or owner roles assigned.
8. Click `Azure role assignments`.
9. Click the name of a read, write, or owner role.
10. Click `Assignments`.
11. Click `Remove` in the row for the disabled user account.
12. Click `Yes`.
13. Repeat steps 7-12 for disabled user accounts requiring remediation.

### Remediate from PowerShell

For each account requiring remediation, run the following command to remove an assigned role:

```powershell
Remove-AzRoleAssignment -ObjectId $user.ObjectId -RoleDefinitionName <role-definition-name>
```

## Default Value

Disabled user accounts retain their prior role assignments.

## References

1. https://learn.microsoft.com/en-us/powershell/module/az.resources/get-azaduser
2. https://learn.microsoft.com/en-us/powershell/module/az.resources/get-azroleassignment
3. https://learn.microsoft.com/en-us/powershell/module/az.resources/remove-azroleassignment

## CIS Controls

| Controls Version | Control                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.1 Establish and Maintain an Inventory of Accounts | x    | x    | x    |
| v7               | 16.6 Maintain an Inventory of Accounts              |      | x    | x    |

## Profile

Level 1 | Manual
