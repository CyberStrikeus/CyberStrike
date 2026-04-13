---
name: cis-azure-foundations-5.18
description: "Ensure 'Restrict user ability to access groups features in My Groups' is set to 'Yes'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, groups, self-service, access-control]
cis_id: "5.18"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.19, cis-azure-foundations-5.20, cis-azure-foundations-5.21]
prerequisites: []
severity_boost: {}
---

# Ensure 'Restrict user ability to access groups features in My Groups' is set to 'Yes'

## Description

Restrict access to group web interface in the Access Panel portal.

## Rationale

Self-service group management enables users to create and manage security groups or Office 365 groups in Microsoft Entra ID. Unless a business requires this day-to-day delegation for some users, self-service group management should be disabled. Any user can access the Access Panel, where they can reset their passwords, view their information, etc. By default, users are also allowed to access the Group feature, which shows groups, members, related resources (SharePoint URL, Group email address, Yammer URL, and Teams URL). By setting this feature to 'Yes', users will no longer have access to the web interface, but still have access to the data using the API. This is useful to prevent non-technical users from enumerating groups-related information, but technical users will still be able to access this information using APIs.

## Impact

Setting to `Yes` could create administrative overhead by customers seeking certain group memberships that will have to be manually managed by administrators with appropriate permissions.

## Audit Procedure

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `Groups`
4. Under `Settings`, select `General`
5. Under `Self Service Group Management`, ensure that `Restrict user ability to access groups features in My Groups` is set to `Yes`

## Expected Result

`Restrict user ability to access groups features in My Groups` should be set to `Yes`.

## Remediation

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `Groups`
4. Under `Settings`, select `General`
5. Under `Self Service Group Management`, set `Restrict user ability to access groups features in My Groups` to `Yes`
6. Click `Save`

## Default Value

By default, `Restrict user ability to access groups features in the Access Pane` is set to `No`.

## References

1. https://learn.microsoft.com/en-us/entra/identity/users/groups-self-service-management
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-privileged-access#pa-1-separate-and-limit-highly-privilegedadministrative-users
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-privileged-access#pa-3-manage-lifecycle-of-identities-and-entitlements
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-governance-strategy#gs-2-define-and-implement-enterprise-segmentationseparation-of-duties-strategy
5. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-governance-strategy#gs-6-define-and-implement-identity-and-privileged-access-strategy

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.8 Define and Maintain Role-Based Access Control     |      |      | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |

## Profile

Level 2 | Manual
