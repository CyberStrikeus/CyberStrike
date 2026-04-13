---
name: cis-azure-foundations-5.27
description: "Ensure there are between 2 and 3 subscription owners"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, subscription-owners, rbac, least-privilege]
cis_id: "5.27"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.26, cis-azure-foundations-5.23]
prerequisites: []
severity_boost: {}
---

# Ensure there are between 2 and 3 subscription owners

## Description

The Owner role in Azure grants full control over all resources in a subscription, including the ability to assign roles to others.

## Rationale

Limit the number of security principals (users, groups, service principals, and managed identities) assigned the Owner role to between 2 and 3. If groups are used, ensure their membership is tightly controlled and regularly reviewed to avoid privilege sprawl.

## Impact

Implementation may require changes in administrative workflows or the redistribution of roles and responsibilities. The recommendation to have between 2 and 3 Owners per subscription must account for all security principals that can be assigned the Owner role, not just individual users. This includes:

- User accounts
- Entra ID groups
- Service principals (used by applications or automation)
- Managed identities (system-assigned or user-assigned)

## Audit Procedure

### Using Azure Portal

1. Go to `Subscriptions`.
2. Click the name of a subscription.
3. Click `Access Controls (IAM)`.
4. Click `Role assignments`.
5. Click `Role : All`.
6. Click the arrow next to `All`.
7. Click `Owner`.
8. Ensure a minimum of 2 and a maximum of 3 members are returned.
9. Repeat steps 1-8 for each subscription.

### Using Azure CLI

```bash
az role assignment list --role Owner --scope /subscriptions/<subscription-id> \
  --query "[].{PrincipalName:principalName, Type:principalType}"
```

Ensure a minimum of 2 and a maximum of 3 members are returned. For each Owner assignment, check: If principalType == Group, review group membership. If principalType == ServicePrincipal or ManagedIdentity, validate necessity and scope. Repeat for each subscription.

### Using PowerShell

```powershell
Get-AzRoleAssignment -RoleDefinitionName Owner -Scope /subscriptions/<subscription-id>
```

Ensure a minimum of 2 and a maximum of 3 members are returned. Repeat for each subscription.

### Using Azure Policy

- **Policy ID:** 09024ccc-0c5f-475e-9457-b7c0d9ed487b - **Name:** 'There should be more than one owner assigned to your subscription'
- **Policy ID:** 4f11b553-d42e-4e3a-89be-32ca364cad4c - **Name:** 'A maximum of 3 owners should be designated for your subscription'

## Expected Result

Each subscription should have a minimum of 2 and a maximum of 3 owners assigned.

## Remediation

### Using Azure Portal

1. Go to `Subscriptions`.
2. Click the name of a subscription.
3. Click `Access Controls (IAM)`.
4. Click `Role assignments`.
5. Click `Role : All`.
6. Click the arrow next to `All`.
7. Click `Owner`.
8. Check the box next to members from whom the owner role should be removed.
9. Click `Delete`.
10. Click `Yes`.
11. Repeat steps 1-10 for each subscription requiring remediation.

### Using Azure CLI

```bash
az role assignment delete --ids <role-assignment-ids>
```

## Default Value

A subscription has 1 owner by default.

## References

1. https://learn.microsoft.com/en-us/cli/azure/role/assignment
2. https://learn.microsoft.com/en-us/powershell/module/az.resources/get-azroleassignment
3. https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/privileged#owner
4. https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments-portal-subscription-admin

## CIS Controls

| Controls Version | Control                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.1 Establish and Maintain an Inventory of Accounts | x    | x    | x    |
| v7               | 4.1 Maintain Inventory of Administrative Accounts   |      | x    | x    |

## Profile

Level 1 | Automated
