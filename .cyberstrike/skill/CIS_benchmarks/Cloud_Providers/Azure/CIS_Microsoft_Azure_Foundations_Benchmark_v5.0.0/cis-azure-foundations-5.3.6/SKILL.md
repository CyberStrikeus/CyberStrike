---
name: cis-azure-foundations-5.3.6
description: "Ensure 'Tenant Creator' role assignments are periodically reviewed"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, identity-reviews]
cis_id: "5.3.6"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.3.5, cis-azure-foundations-5.3.7]
prerequisites: []
severity_boost: {}
---

# Ensure 'Tenant Creator' role assignments are periodically reviewed

## Description

Perform a periodic review of the Tenant Creator role assignment to ensure that the assignments are accurate and appropriate.

This recommendation should be applied alongside the recommendation **"Ensure that 'Restrict non-admin users from creating tenants' is set to 'Yes'"**.

## Rationale

Unnecessary assignments increase the risk of privilege escalation and unauthorized access.

## Impact

Verify that the Tenant Creator role is no longer required by any assignments before removal to avoid disruption of critical functions.

## Audit Procedure

### Using Azure Portal

1. Go to `Microsoft Entra ID`.
2. Under `Manage`, click `Roles and administrators`.
3. In the search bar, type `Tenant Creator`.
4. Click the role.
5. Review the assignments and ensure that they are appropriate.

## Expected Result

The Tenant Creator role should have no unnecessary assignments. All assignments should be justified and documented.

## Remediation

### Remediate from Azure Portal

1. Go to `Microsoft Entra ID`.
2. Under `Manage`, click `Roles and administrators`.
3. In the search bar, type `Tenant Creator`.
4. Click the role.
5. Click the name of an assignment.
6. Check the box next to the `Tenant Creator` role.
7. Click `X Remove assignments`.
8. Click `Yes`.
9. Repeat steps 1-8 for each assignment requiring remediation.

## Default Value

The Tenant Creator role is not assigned by default.

## References

1. https://learn.microsoft.com/en-us/azure/active-directory-b2c/tenant-management-check-tenant-creation-permission
2. https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/permissions-reference#tenant-creator

## CIS Controls

| Controls Version | Control                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | x    | x    | x    |
| v7               | 4.3 Ensure the Use of Dedicated Administrative Accounts                   | x    | x    | x    |

## Profile

Level 1 | Manual
