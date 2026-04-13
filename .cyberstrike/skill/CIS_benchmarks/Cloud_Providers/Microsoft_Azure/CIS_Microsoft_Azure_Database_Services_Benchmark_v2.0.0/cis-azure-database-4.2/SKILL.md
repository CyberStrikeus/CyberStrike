---
name: cis-azure-database-4.2
description: "Ensure Data Factory is using Managed Identities"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, data-factory, adf]
cis_id: "4.2"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2 Ensure Data Factory is using Managed Identities (Automated)

## Profile Applicability

- Level 1

## Description

Managed identities are the roles that Azure services assume to access other services or resources. Access and permissions may be set on these roles to set the scope and reach of what a service can access. Setting a service to use a managed identity also prevents the need to store credentials in code or other less secure options.

## Rationale

Managed identities eliminate the need to store and manage credentials to access Azure resources. Scoping permissions of a managed identity to a specific set of resources also prevents unwanted access elsewhere.

## Impact

Initial administrative overhead to configure and manage role assignments for managed identities.

## Audit

### Audit from Azure Portal

1. From `Data Factories` select a factory to audit.
2. In the left column expand `> Settings`.
3. Select `Managed identities`.
4. In the top `System assigned` menu, determine if the default identity is in use under `Status`, by whether this is set to `On`.
5. Determine if there are any custom identities assigned to this resource by selecting in the top menu `User Assigned`.

### Audit From Azure Policy

If referencing a digital copy of this Benchmark, clicking a Policy ID will open a link to the associated Policy definition in Azure.

If referencing a printed copy, you can search Policy IDs from this URL:
https://portal.azure.com/#view/Microsoft_Azure_Policy/PolicyMenuBlade/~/Definitions

- **Policy ID:** `f78ccdb4-7bf4-4106-8647-270491d2978a` - **Name:** 'Azure Data Factory linked services should use system-assigned managed identity authentication when it is supported'

## Expected Result

The `Status` under System assigned should be set to `On`, indicating that a managed identity is in use for the Data Factory.

## Remediation

### Remediate from Azure Portal

1. From `Data Factories` select a factory to remediate.
2. In the left column expand `> Settings`.
3. Select `Managed identities`.
4. From the `System Assigned` tab, under `Permissions` select `Azure role assignments`.
5. `Select + Add role assignments (Preview)`.
6. Select a `Scope`, `Subscription` and `Role` to be added.
7. Select `Save`.

## Default Value

By default, Data Factories use a system assigned managed identity, with no permissions to resources set.

## References

1. https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/overview
2. https://learn.microsoft.com/en-us/azure/data-factory/data-factory-service-identity
