---
name: cis-azure-database-2.5
description: "Ensure that 'System Assigned Managed Identity' is set to 'On'"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, redis, cache]
cis_id: "2.5"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.5 Ensure that 'System Assigned Managed Identity' is set to 'On' (Manual)

## Profile Applicability

- Level 1

## Description

System Assigned Managed Identities provide the Azure Cache for Redis instance with a unique account like a service principle but automatically assigned and managed by Azure. These identities are unique to the resource instance they are created for, and removed when the resource is deleted.

## Rationale

The System Assigned Managed Identity is authenticated with Entra ID, and allows for privileges required for the instance of Azure Cache for Redis to be granted or restricted using Azure Role Based Access Control (RBAC). Additionally, the managed identity provides a means for the Azure Cache for Redis instance to authenticate without storing credentials in code.

## Impact

No additional cost or performance impact is expected.

## Audit Procedure

### Audit From Azure Portal

1. Search for and open the `Azure Cache for Redis` service
2. For each instance, repeat the remaining steps
3. Click on the name of the instance
4. In the blade menu on the left, under Settings, click on **Identity**
5. Under the `System assigned` tab, ensure that `Status` is set to **On**.

If **Yes** is selected and `Object (principal) ID` is populated, the configuration for that instance is compliant.

## Expected Result

The `System assigned` managed identity `Status` should be set to **On** and an `Object (principal) ID` should be populated.

## Remediation

### Remediate From Azure Portal

1. Search for and open the `Azure Cache for Redis` service
2. For each instance, repeat the remaining steps
3. Click on the name of the instance
4. In the blade menu on the left, under Settings, click on **Identity**
5. Under the `System assigned` tab, toggle the status to **On**
6. Click the **Save** button
7. In the pop-up dialog titled `Enable system assigned managed identity` that appears after clicking save, click the **Yes** button.

## Default Value

By default, System Assigned Managed Identity of **Off**.

## References

1. [https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/cache-managed-identity](https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/cache-managed-identity)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 5.5 Establish and Maintain an Inventory of Service Accounts | | X | X |
