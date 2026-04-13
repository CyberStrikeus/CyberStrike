---
name: cis-azure-database-2.1
description: "Ensure 'Microsoft Entra Authentication' is 'Enabled'"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, redis, cache]
cis_id: "2.1"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1 Ensure 'Microsoft Entra Authentication' is 'Enabled' (Manual)

## Profile Applicability

- Level 1

## Description

Ensuring that Microsoft Entra Authentication is 'Enabled' provides a natively integrated use of identities already defined with Microsoft Entra ID.

## Rationale

The use of a centralized Identity and Access Management (IAM) solution such as Microsoft Entra ID is highly recommended for all activity related to Identity, Authentication, Authorization, and Accountability.

Decentralized IAM -- such as local authentication methods -- may present additional vulnerability and introduce avoidable administrative complexity.

## Impact

Free tiers exist for the licensing of Microsoft Entra ID if required.

## Audit Procedure

### Audit From Azure Portal

1. Search for and open the `Azure Cache for Redis` service
2. For each instance, repeat the remaining steps
3. Click on the name of the instance
4. In the blade menu on the left, click on **Authentication**
5. Review the checkbox next to `Enable Microsoft Entra Authentication`

If the checkbox is **Checked**, the configuration for that instance is compliant.

## Expected Result

The checkbox next to `Enable Microsoft Entra Authentication` should be **Checked** for each Azure Cache for Redis instance.

## Remediation

### Remediate From Azure Portal

1. Search for and open the `Azure Cache for Redis` service
2. For each instance, repeat the remaining steps
3. Click on the name of the instance
4. In the blade menu on the left, click on **Authentication**
5. **Check** the checkbox next to `Enable Microsoft Entra Authentication`

## Default Value

By default, Microsoft Entra Authentication is **Checked** during setup.

## References

1. [https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-identity-management](https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-identity-management)
2. [https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/cache-azure-active-directory-for-authentication](https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/cache-azure-active-directory-for-authentication)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 5.6 Centralize Account Management | | X | X |
| v7 | 16.2 Configure Centralized Point of Authentication | | X | X |
