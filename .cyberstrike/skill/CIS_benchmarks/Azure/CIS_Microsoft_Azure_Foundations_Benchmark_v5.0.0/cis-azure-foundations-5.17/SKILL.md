---
name: cis-azure-foundations-5.17
description: "Ensure 'Restrict access to Microsoft Entra admin center' is set to 'Yes'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, admin-center, access-restriction, least-privilege]
cis_id: "5.17"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.4, cis-azure-foundations-5.26]
prerequisites: []
severity_boost: {}
---

# Ensure 'Restrict access to Microsoft Entra admin center' is set to 'Yes'

## Description

Restrict access to the Microsoft Entra ID administration center to administrators only.

**NOTE**: This only affects access to the Entra ID administrator's web portal. This setting does not prohibit privileged users from using other methods such as Rest API or Powershell to obtain sensitive information from Microsoft Entra ID.

## Rationale

The Microsoft Entra ID administrative center has sensitive data and permission settings. All non-administrators should be prohibited from accessing any Microsoft Entra ID data in the administration center to avoid exposure.

## Impact

All administrative tasks will need to be done by Administrators, causing additional overhead in management of users and resources.

## Audit Procedure

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `Users`
4. Under `Manage`, select `User settings`
5. Under `Administration centre`, ensure that `Restrict access to Microsoft Entra admin center` is set to `Yes`

## Expected Result

`Restrict access to Microsoft Entra admin center` should be set to `Yes`.

## Remediation

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `Users`
4. Under `Manage`, select `User settings`
5. Under `Administration centre`, set `Restrict access to Microsoft Entra admin center` to `Yes`
6. Click `Save`

## Default Value

By default, `Restrict access to Microsoft Entra admin center` is set to `No`.

## References

1. https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/permissions-reference
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-governance-strategy#gs-2-define-and-implement-enterprise-segmentationseparation-of-duties-strategy
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-governance-strategy#gs-6-define-and-implement-identity-and-privileged-access-strategy
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-privileged-access#pa-1-separate-and-limit-highly-privilegedadministrative-users

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | x | x | x |
| v8 | 6.8 Define and Maintain Role-Based Access Control | | | x |
| v7 | 4.3 Ensure the Use of Dedicated Administrative Accounts | x | x | x |

## Profile

Level 1 | Manual
