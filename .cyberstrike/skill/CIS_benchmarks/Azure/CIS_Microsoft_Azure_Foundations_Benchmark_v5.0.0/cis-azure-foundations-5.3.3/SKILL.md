---
name: cis-azure-foundations-5.3.3
description: "Ensure use of the 'User Access Administrator' role is restricted"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, identity-reviews]
cis_id: "5.3.3"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.3.4, cis-azure-foundations-5.3.5]
prerequisites: []
severity_boost: {}
---

# Ensure use of the 'User Access Administrator' role is restricted

## Description

The User Access Administrator role grants the ability to view all resources and manage access assignments at any subscription or management group level within the tenant. Due to its high privilege level, this role assignment should be removed immediately after completing the necessary changes at the root scope to minimize security risks.

## Rationale

The User Access Administrator role provides extensive access control privileges. Unnecessary assignments heighten the risk of privilege escalation and unauthorized access. Removing the role immediately after use minimizes security exposure.

## Impact

Increased administrative effort to manage and remove role assignments appropriately.

## Audit Procedure

### Using Azure Portal

1. From Azure Home select the Portal Menu.
2. Select `Subscriptions`.
3. Select a subscription.
4. Select `Access control (IAM)`.
5. Look for the following banner at the top of the page: `Action required: X users have elevated access in your tenant. You should take immediate action and remove all role assignments with elevated access.` If the banner is displayed, the `User Access Administrator` is assigned.

### Using Azure CLI

```bash
az role assignment list --role "User Access Administrator" --scope "/"
```

Ensure that the command does not return any `User Access Administrator` role assignment information.

## Expected Result

No users should have the User Access Administrator role assigned at the root scope ("/"). The Azure CLI command should return an empty result, and no banner warning should appear in the Azure Portal.

## Remediation

### Remediate from Azure Portal

1. From Azure Home select the Portal Menu.
2. Select `Subscriptions`.
3. Select a subscription.
4. Select `Access control (IAM)`.
5. Look for the following banner at the top of the page: `Action required: X users have elevated access in your tenant. You should take immediate action and remove all role assignments with elevated access.`
6. Click `View role assignments`.
7. Click `Remove`.

### Remediate from Azure CLI

```bash
az role assignment delete --role "User Access Administrator" --scope "/"
```

## Default Value

The User Access Administrator role is not assigned by default.

## References

1. https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles
2. https://learn.microsoft.com/en-us/azure/role-based-access-control/elevate-access-global-admin

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.8 Define and Maintain Role-Based Access Control |      |      | x    |
| v7               | 4.1 Maintain Inventory of Administrative Accounts |      | x    | x    |

## Profile

Level 1 | Automated
