---
name: cis-azure-foundations-5.21
description: "Ensure 'Users can create Microsoft 365 groups in Azure portals, API or PowerShell' is set to 'No'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, microsoft-365, group-creation, least-privilege]
cis_id: "5.21"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.19, cis-azure-foundations-5.18]
prerequisites: []
severity_boost: {}
---

# Ensure 'Users can create Microsoft 365 groups in Azure portals, API or PowerShell' is set to 'No'

## Description

Restrict Microsoft 365 group creation to administrators only.

## Rationale

Restricting Microsoft 365 group creation to administrators only ensures that creation of Microsoft 365 groups is controlled by the administrator. Appropriate groups should be created and managed by the administrator and group creation rights should not be delegated to any other user.

## Impact

Enabling this setting could create a number of requests that would need to be managed by an administrator.

## Audit Procedure

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `Groups`
4. Under `Settings`, select `General`
5. Under `Microsoft 365 Groups`, ensure that `Users can create Microsoft 365 groups in Azure portals, API or PowerShell` is set to `No`

## Expected Result

`Users can create Microsoft 365 groups in Azure portals, API or PowerShell` should be set to `No`.

## Remediation

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `Groups`
4. Under `Settings`, select `General`
5. Under `Microsoft 365 Groups`, set `Users can create Microsoft 365 groups in Azure portals, API or PowerShell` to `No`
6. Click `Save`

## Default Value

By default, `Users can create Microsoft 365 groups in Azure portals, API or PowerShell` is set to `Yes`.

## References

1. https://learn.microsoft.com/en-us/microsoft-365/solutions/manage-creation-of-groups
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-governance-strategy#gs-6-define-and-implement-identity-and-privileged-access-strategy
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-governance-strategy#gs-2-define-and-implement-enterprise-segmentationseparation-of-duties-strategy
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-privileged-access#pa-1-separate-and-limit-highly-privilegedadministrative-users
5. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-privileged-access#pa-3-manage-lifecycle-of-identities-and-entitlements

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.8 Define and Maintain Role-Based Access Control     |      |      | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |

## Profile

Level 2 | Manual
