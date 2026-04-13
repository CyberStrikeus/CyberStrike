---
name: cis-azure-foundations-5.3.2
description: "Ensure guest users are reviewed on a regular basis"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, identity-reviews]
cis_id: "5.3.2"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.3.1, cis-azure-foundations-5.3.3]
prerequisites: []
severity_boost: {}
---

# Ensure guest users are reviewed on a regular basis

## Description

Microsoft Entra ID has native and extended identity functionality allowing you to invite people from outside your organization to be guest users in your cloud account and sign in with their own work, school, or social identities.

While an automated assessment procedure exists for this recommendation, the assessment status remains manual. Evaluating the appropriateness of guest users requires a manual review, as it depends on the specific needs and context of each organization and environment.

## Rationale

Guest users are typically added outside your employee on-boarding/off-boarding process and could potentially be overlooked indefinitely. To prevent this, guest users should be reviewed on a regular basis. During this audit, guest users should also be determined to not have administrative privileges.

## Impact

Before removing guest users, determine their use and scope. Like removing any user, there may be unforeseen consequences to systems if an account is removed without careful consideration.

## Audit Procedure

### Using Azure Portal

1. From Azure Home select the Portal Menu.
2. Select `Microsoft Entra ID`.
3. Under `Manage`, select `Users`.
4. Click on `Add filter`.
5. Select `User type`.
6. Select `Guest` from the Value dropdown.
7. Click `Apply`.
8. Audit the listed guest users.

### Using Azure CLI

```bash
az ad user list --query "[?userType=='Guest']"
```

Ensure all users listed are still required and not inactive.

### Using Azure PowerShell

```powershell
Get-AzureADUser |Where-Object {$_.UserType -like "Guest"} |Select-Object DisplayName, UserPrincipalName, UserType -Unique
```

### Using Azure Policy

- **Policy ID:** e9ac8f8e-ce22-4355-8f04-99b911d6be52 - **Name:** 'Guest accounts with read permissions on Azure resources should be removed'
- **Policy ID:** 94e1c2ac-cbbe-4cac-a2b5-389c812dee87 - **Name:** 'Guest accounts with write permissions on Azure resources should be removed'
- **Policy ID:** 339353f6-2387-4a45-abe4-7f529d121046 - **Name:** 'Guest accounts with owner permissions on Azure resources should be removed'

## Expected Result

All listed guest users should be currently required, active, and appropriate for the organization. No guest users should have unnecessary administrative privileges.

## Remediation

### Remediate from Azure Portal

1. From Azure Home select the Portal Menu.
2. Select `Microsoft Entra ID`.
3. Under `Manage`, select `Users`.
4. Click on `Add filter`.
5. Select `User type`.
6. Select `Guest` from the Value dropdown.
7. Click `Apply`.
8. Check the box next to all `Guest` users that are no longer required or are inactive.
9. Click `Delete`.
10. Click `OK`.

### Remediate from Azure CLI

Before deleting the user, set it to inactive using the ID from the Audit Procedure to determine if there are any dependent systems.

```bash
az ad user update --id <exampleaccountid@domain.com> --account-enabled {false}
```

After determining that there are no dependent systems, delete the user.

```powershell
Remove-AzureADUser -ObjectId <exampleaccountid@domain.com>
```

### Remediate from Azure PowerShell

Before deleting the user, set it to inactive using the ID from the Audit Procedure to determine if there are any dependent systems.

```powershell
Set-AzureADUser -ObjectId "<exampleaccountid@domain.com>" -AccountEnabled false
```

After determining that there are no dependent systems, delete the user.

```powershell
PS C:\>Remove-AzureADUser -ObjectId <exampleaccountid@domain.com>
```

## Default Value

By default no guest users are created.

## References

1. https://learn.microsoft.com/en-us/entra/external-id/user-properties
2. https://learn.microsoft.com/en-us/entra/fundamentals/how-to-create-delete-users#delete-a-user
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-privileged-access#pa-4-review-and-reconcile-user-access-regularly
4. https://www.microsoft.com/en-us/security/business/microsoft-entra-pricing
5. https://learn.microsoft.com/en-us/entra/identity/monitoring-health/howto-manage-inactive-user-accounts
6. https://learn.microsoft.com/en-us/entra/fundamentals/users-restore

## CIS Controls

| Controls Version | Control                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.1 Establish and Maintain an Inventory of Accounts | x    | x    | x    |
| v8               | 5.3 Disable Dormant Accounts                        | x    | x    | x    |
| v7               | 16.6 Maintain an Inventory of Accounts              |      | x    | x    |
| v7               | 16.8 Disable Any Unassociated Accounts              | x    | x    | x    |

## Profile

Level 1 | Manual
