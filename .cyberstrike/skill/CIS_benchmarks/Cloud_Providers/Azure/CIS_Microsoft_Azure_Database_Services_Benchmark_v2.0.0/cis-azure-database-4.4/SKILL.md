---
name: cis-azure-database-4.4
description: "Ensure that Data Factory is using RBAC to manage privilege assignment"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, data-factory, adf]
cis_id: "4.4"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.4 Ensure that Data Factory is using RBAC to manage privilege assignment (Manual)

## Profile Applicability

- Level 2

## Description

Role Based Access Control (RBAC) is setting permissions to the role that a user occupies. Often the user is added to a group which the account inherits permissions from. This is different than Access Policies which are used on an individual case by case basis for each user.

## Rationale

RBAC enhances security by limiting user privilege to only what is necessary for a job role, reducing the risk of unauthorized access. Additionally, RBAC aids compliance with regulations and provides clear accountability by tracking access activities linked to specific roles.

## Impact

There will be a slight increase in technical overhead in that user permissions will need to be manually assigned. However once added to a group, permissions may be edited for every account in the group at one time.

## Audit

### Audit from Azure Portal

1. From `Data Factories` select a data factory to audit.
2. In the left column select `Access control (IAM)`.
3. To check an individual account or group, in the horizontal row, select `Check access`, then search for a user, group, or managed identity.
4. To check all roles, in the horizontal row select `Role assignments`, and scroll through all the roles that have permission to this data factory.

## Expected Result

Appropriate RBAC role assignments should be configured for the Data Factory, with roles scoped to the minimum necessary permissions for each user or group.

## Remediation

### Remediate from Azure Portal

1. From `Data Factories` select a data factory to audit.
2. In the left column select `Access control (IAM)`.
3. Select `+ Add \/` and then `Add role assignment`.
4. Select the builtin or custom role to be added. Then select `Next`.
5. Next to `Assign access to` select either `User, group, or service principal` or `Managed identity` to be added to this role.
6. Choose `Select members`, then search for the resource that is to be added to this role.
7. Enter a description if desired.
8. Select `Next`, review your choices, then `Review + assign`.

## Default Value

By default, Data factories use RBAC but only with permissions for owners to make changes.

## References

1. https://learn.microsoft.com/en-us/azure/data-factory/concepts-roles-permissions
