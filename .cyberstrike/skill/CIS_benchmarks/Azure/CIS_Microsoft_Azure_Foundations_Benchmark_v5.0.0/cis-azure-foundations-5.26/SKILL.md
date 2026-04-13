---
name: cis-azure-foundations-5.26
description: "Ensure fewer than 5 users have global administrator assignment"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, global-admin, privileged-access, least-privilege]
cis_id: "5.26"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.27, cis-azure-foundations-5.11]
prerequisites: []
severity_boost: {}
---

# Ensure fewer than 5 users have global administrator assignment

## Description

This recommendation aims to maintain a balance between security and operational efficiency by ensuring that a minimum of 2 and a maximum of 4 users are assigned the Global Administrator role in Microsoft Entra ID. Having at least two Global Administrators ensures redundancy, while limiting the number to four reduces the risk of excessive privileged access.

## Rationale

The Global Administrator role has extensive privileges across all services in Microsoft Entra ID. The Global Administrator role should never be used in regular daily activities; administrators should have a regular user account for daily activities, and a separate account for administrative responsibilities. Limiting the number of Global Administrators helps mitigate the risk of unauthorized access, reduces the potential impact of human error, and aligns with the principle of least privilege to reduce the attack surface of an Azure tenant. Conversely, having at least two Global Administrators ensures that administrative functions can be performed without interruption in case of unavailability of a single admin.

For any accounts assigned the Global Administrator role, at least one strong authentication method such as a FIDO2 key or certificate is strongly advised.

## Impact

Implementing this recommendation may require changes in administrative workflows or the redistribution of roles and responsibilities. Adequate training and awareness should be provided to all Global Administrators.

NOTE: If an organization's tenant is using a third-party identity provider, the audit and remediation procedures presented here may not be relevant. The principle of the recommendation is still relevant, and compensating controls that are relevant to the third-party identity provider should be implemented.

## Audit Procedure

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `Roles and administrators`
4. Under `Administrative Roles`, select `Global Administrator`
5. Ensure less than 5 users are actively assigned the role.
6. Ensure that at least 2 users are actively assigned the role.

## Expected Result

Between 2 and 4 users (inclusive) should be actively assigned the Global Administrator role.

## Remediation

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `Roles and administrators`
4. Under `Administrative Roles`, select `Global Administrator`

If more than 4 users are assigned:

1. Remove Global Administrator role for users which do not or no longer require the role.
2. Assign Global Administrator role via PIM which can be activated when required.
3. Assign more granular roles to users to conduct their duties.

If only one user is assigned:

1. Provide the Global Administrator role to a trusted user or create a break glass admin account.

## Default Value

By default, there is one Global Administrator assigned during tenant creation.

## References

1. https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/best-practices#5-limit-the-number-of-global-administrators-to-less-than-5
2. https://learn.microsoft.com/en-us/microsoft-365/admin/add-users/about-admin-roles?view=o365-worldwide#security-guidelines-for-assigning-roles
3. https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-emergency-access
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-privileged-access#pa-1-separate-and-limit-highly-privilegedadministrative-users

## CIS Controls

| Controls Version | Control                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.1 Establish and Maintain an Inventory of Accounts | x    | x    | x    |
| v7               | 4.1 Maintain Inventory of Administrative Accounts   |      | x    | x    |

## Profile

Level 1 | Manual
