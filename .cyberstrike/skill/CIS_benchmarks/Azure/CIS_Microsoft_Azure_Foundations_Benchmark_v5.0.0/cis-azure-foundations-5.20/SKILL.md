---
name: cis-azure-foundations-5.20
description: "Ensure 'Owners can manage group membership requests in My Groups' is set to 'No'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, group-management, self-service, least-privilege]
cis_id: "5.20"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.18, cis-azure-foundations-5.19]
prerequisites: []
severity_boost: {}
---

# Ensure 'Owners can manage group membership requests in My Groups' is set to 'No'

## Description

Restrict security group management to administrators only.

## Rationale

Restricting security group management to administrators only prohibits users from making changes to security groups. This ensures that security groups are appropriately managed and their management is not delegated to non-administrators.

## Impact

Group Membership for user accounts will need to be handled by Admins and cause administrative overhead.

## Audit Procedure

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `Groups`
4. Under `Settings`, select `General`
5. Under `Self Service Group Management`, ensure that `Owners can manage group membership requests in My Groups` is set to `No`

## Expected Result

`Owners can manage group membership requests in My Groups` should be set to `No`.

## Remediation

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `Groups`
4. Under `Settings`, select `General`
5. Under `Self Service Group Management`, set `Owners can manage group membership requests in My Groups` to `No`
6. Click `Save`

## Default Value

By default, `Owners can manage group membership requests in My Groups` is set to `No`.

## References

1. https://learn.microsoft.com/en-us/entra/identity/users/groups-self-service-management#making-a-group-available-for-end-user-self-service
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-privileged-access#pa-1-separate-and-limit-highly-privilegedadministrative-users
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-privileged-access#pa-3-manage-lifecycle-of-identities-and-entitlements
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-privileged-access#pa-8-determine-access-process-for-cloud-provider-support
5. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-governance-strategy#gs-2-define-and-implement-enterprise-segmentationseparation-of-duties-strategy
6. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-governance-strategy#gs-6-define-and-implement-identity-and-privileged-access-strategy

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 6.8 Define and Maintain Role-Based Access Control | | | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |

## Profile

Level 2 | Manual
