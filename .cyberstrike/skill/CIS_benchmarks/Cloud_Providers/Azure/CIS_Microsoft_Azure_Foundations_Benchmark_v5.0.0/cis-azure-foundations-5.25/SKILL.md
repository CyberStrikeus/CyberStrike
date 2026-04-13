---
name: cis-azure-foundations-5.25
description: "Ensure 'Subscription leaving/entering Microsoft Entra tenant' is set to 'Permit no one'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, subscription-management, tenant-security, access-control]
cis_id: "5.25"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.23, cis-azure-foundations-5.27]
prerequisites: []
severity_boost: {}
---

# Ensure 'Subscription leaving/entering Microsoft Entra tenant' is set to 'Permit no one'

## Description

Users who are set as subscription owners are able to make administrative changes to the subscriptions and move them into and out of Microsoft Entra ID.

## Rationale

Permissions to move subscriptions in and out of a Microsoft Entra tenant must only be given to appropriate administrative personnel. A subscription that is moved into a Microsoft Entra tenant may be within a folder to which other users have elevated permissions. This prevents loss of data or unapproved changes of the objects within by potential bad actors.

## Impact

Subscriptions will need to have these settings turned off to be moved.

## Audit Procedure

### Using Azure Portal

1. From the Azure Portal Home select the portal menu
2. Select `Subscriptions`
3. In the `Advanced options` drop-down menu, select `Manage Policies`
4. Ensure `Subscription leaving Microsoft Entra tenant` and `Subscription entering Microsoft Entra tenant` are set to `Permit no one`

## Expected Result

Both `Subscription leaving Microsoft Entra tenant` and `Subscription entering Microsoft Entra tenant` should be set to `Permit no one`.

## Remediation

### Using Azure Portal

1. From the Azure Portal Home select the portal menu
2. Select `Subscriptions`
3. In the `Advanced options` drop-down menu, select `Manage Policies`
4. Set `Subscription leaving Microsoft Entra tenant` and `Subscription entering Microsoft Entra tenant` to `Permit no one`
5. Click `Save changes`

## Default Value

By default `Subscription leaving Microsoft Entra tenant` and `Subscription entering Microsoft Entra tenant` are set to `Allow everyone (default)`.

## References

1. https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/manage-azure-subscription-policy
2. https://learn.microsoft.com/en-us/entra/fundamentals/how-subscriptions-associated-directory
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-identity-management#im-2-protect-identity-and-authentication-systems

## CIS Controls

| Controls Version | Control                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | x    | x    | x    |
| v8               | 6.1 Establish an Access Granting Process                                  | x    | x    | x    |
| v8               | 6.2 Establish an Access Revoking Process                                  | x    | x    | x    |
| v7               | 4.3 Ensure the Use of Dedicated Administrative Accounts                   | x    | x    | x    |

## Profile

Level 2 | Manual
