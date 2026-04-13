---
name: cis-azure-foundations-5.23
description: "Ensure no custom subscription administrator roles exist"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, rbac, custom-roles, least-privilege, subscription]
cis_id: "5.23"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.24, cis-azure-foundations-5.27]
prerequisites: []
severity_boost: {}
---

# Ensure no custom subscription administrator roles exist

## Description

The principle of least privilege should be followed and only necessary privileges should be assigned instead of allowing full administrative access.

## Rationale

Custom roles in Azure with administrative access can obfuscate the permissions granted and introduce complexity and blind spots to the management of privileged identities. For less mature security programs without regular identity audits, the creation of Custom roles should be avoided entirely. For more mature security programs with regular identity audits, Custom Roles should be audited for use and assignment, used minimally, and the principle of least privilege should be observed when granting permissions.

## Impact

Subscriptions will need to be handled by Administrators with permissions.

## Audit Procedure

### Using Azure Portal

1. From Azure Home select the Portal Menu.
2. Select `Subscriptions`.
3. Select a subscription.
4. Select `Access control (IAM)`.
5. Select `Roles`.
6. Click `Type` and select `Custom role` from the drop-down menu.
7. Select `View` next to a role.
8. Select `JSON`.
9. Check for `assignableScopes` set to the subscription, and `actions` set to `*`.
10. Repeat steps 7-9 for each custom role.

### Using Azure CLI

```bash
az role definition list --custom-role-only True
```

Check for entries with `assignableScope` of the `subscription`, and an action of `*`.

### Using PowerShell

```powershell
Connect-AzAccount
Get-AzRoleDefinition | Where-Object {($_.IsCustom -eq $true) -and ($_.Actions.contains('*'))}
```

Check the output for `AssignableScopes` value set to the subscription.

### Using Azure Policy

- **Policy ID:** a451c1ef-c6ca-483d-87ed-f49761e3ffb5 - **Name:** 'Audit usage of custom RBAC roles'

## Expected Result

No custom roles should exist with `assignableScopes` set to the subscription and `actions` set to `*`.

## Remediation

### Using Azure Portal

1. From Azure Home select the Portal Menu.
2. Select `Subscriptions`.
3. Select a subscription.
4. Select `Access control (IAM)`.
5. Select `Roles`.
6. Click `Type` and select `Custom role` from the drop-down menu.
7. Check the box next to each role which grants subscription administrator privileges.
8. Select `Delete`.
9. Select `Yes`.

### Using Azure CLI

```bash
az role definition list --custom-role-only True
```

Check for entries with `assignableScope` of the `subscription`, and an action of `*`.

To remove a violating role:

```bash
az role definition delete --name <role name>
```

Note that any role assignments must be removed before a custom role can be deleted. Ensure impact is assessed before deleting a custom role granting subscription administrator privileges.

## Default Value

By default, no custom owner roles are created.

## References

1. https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/add-change-subscription-administrator
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-privileged-access#pa-1-separate-and-limit-highly-privilegedadministrative-users
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-privileged-access#pa-3-manage-lifecycle-of-identities-and-entitlements
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-governance-strategy#gs-2-define-and-implement-enterprise-segmentationseparation-of-duties-strategy
5. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-governance-strategy#gs-6-define-and-implement-identity-and-privileged-access-strategy
6. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-privileged-access#pa-7-follow-just-enough-administration-least-privilege-principle

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | x | x | x |
| v8 | 6.8 Define and Maintain Role-Based Access Control | | | x |
| v7 | 4.1 Maintain Inventory of Administrative Accounts | | x | x |

## Profile

Level 1 | Automated
