---
name: cis-azure-compute-3.3
description: "Ensure the principle of least privilege is used when assigning roles to a Managed Identity"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, container-instances, aci]
cis_id: "3.3"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the principle of least privilege is used when assigning roles to a Managed Identity

## Description

When using either a user-assigned or system-assigned managed identity, those identities may require a role or privilege assignment to perform a desired function. The roles or privileges assigned to that identity should be assigned with the principle of least privilege in mind - the identity is given the minimum levels of access or permissions needed to perform the job.

## Rationale

Threat actors may attempt to compromise service accounts as anomalous activity on these accounts can sometimes be more challenging to detect. Limiting the permissions or roles available to a managed identity or service account assists in mitigating the systemic exploitation that a service account can perform if compromised.

## Impact

All service accounts should be inventoried and reviewed from time to time for necessity and role or privilege assignment.

## Audit Procedure

### Using Azure Portal

For each Container Instance that uses an identity or credential:

1. Open the `Container Instances` blade.
2. Select a named container instance.
3. Click on `Identity` under the Settings section.
4. Review the `System Assigned` and `User Assigned` tabs for assigned identities.

For a System Assigned identity, click on `Azure role assignments` and review the assigned roles for appropriate restriction.

For User assigned identities, click on the name of each User assigned managed identity, then click on `Azure role assignments` in the left panel to review assigned roles for appropriate restriction.

## Expected Result

All managed identities assigned to Container Instances should have only the minimum required roles and permissions necessary for their intended function.

## Remediation

### Using Azure Portal

**NOTE**: Remediation will vary based on the needs of your environment. Before remediating, determine the scope and requirements of the Role Assignments necessary for your environment: https://learn.microsoft.com/en-us/azure/active-directory/roles/permissions-reference

For each Container Instance that uses an identity or credential:

1. Open the `Container Instances` blade.
2. Select a named container instance.
3. Click on `Identity` under the Settings section.
4. Review the `System Assigned` and `User Assigned` tabs for assigned identities.

For a System Assigned identity, click on `Azure role assignments` and Add or Remove assigned roles for appropriate restriction.

For User assigned identities, click on the name of each User assigned managed identity, then click on `Azure role assignments` in the left panel to Add or Remove assigned roles for appropriate restriction.

## Default Value

By default, Managed Identities are not configured on Container Instances.

## References

1. https://learn.microsoft.com/en-us/azure/container-instances/container-instances-managed-identity
2. https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments-portal
3. https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments-portal-managed-identity
4. https://learn.microsoft.com/en-us/azure/active-directory/roles/permissions-reference

## Profile

Level 1 | Manual
