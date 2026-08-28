---
name: cis-azure-database-2.4
description: "Ensure that 'Access Policies' are Implemented and Reviewed Periodically"
category: cis-azure-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, redis, cache]
cis_id: "2.4"
cis_benchmark: "CIS Microsoft Azure Database Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.4 Ensure that 'Access Policies' are Implemented and Reviewed Periodically (Manual)

## Profile Applicability

- Level 2

## Description

Access Policies provide an Access Control List (ACL) functionality allowing administrators to define which identities or identity groups have access to what data and commands. This is an implementation of the Role Based Access Control (RBAC) concept and will require careful consideration to deploy and maintain.

## Rationale

Role Based Access Control (RBAC) using Access Control Lists (ACLs) is a method of implementing the principle of least privilege by ensuring that users and user groups with differing needs are presented with the privilege that fulfills their needs and any unnecessary access or functionality is prevented.

## Impact

Implementing RBAC for any system requires a careful analysis of 'who' needs access to the system, and 'what' privileges or functionality they need to perform. The time required to implement RBAC will increase based on the complexity and size of an environment.

If RBAC is deployed without careful analysis, it may prevent users from accessing data or functionality that they require from the system. Conversely, it may present privilege which is unnecessary and introduce vulnerability to a system.

Once RBAC has been deployed, there should be periodically scheduled access review. During the access review, all entries in the Access Control List and all identities are reviewed for fitness and necessity.

## Audit Procedure

### Audit From Azure Portal

1. Search for and open the `Azure Cache for Redis` service
2. For each instance, repeat the remaining steps
3. Click on the name of the instance
4. In the blade menu on the left, under Settings, click on **Data Access Configuration**
5. Click on the tab titled `Access Policies` and review the access policies for fitness and necessity.

**Please note:** No more specific definition can be presented here because the definitions of fitness and necessity are judgments that must be made by the administrators and security personnel with knowledge of the identities and functionality required of the system being evaluated.

## Expected Result

Access Policies should be configured with appropriate least-privilege permissions and reviewed periodically for fitness and necessity.

## Remediation

No prescriptive remediation is available due to the specific and unique nature of implementing RBAC for any given system. Implementing RBAC for any system requires a careful analysis of 'who' needs access to the system, and 'what' privileges or functionality they require. The time required to implement RBAC will increase based on the complexity and size of an environment.

## Default Value

By default, no Access Policies exist.

## References

1. [https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/cache-configure-role-based-access-control](https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/cache-configure-role-based-access-control)

## CIS Controls

| Controls Version | Control                                                     | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.8 Define and Maintain Role-Based Access Control           |      |      | X    |
| v7               | 14.7 Enforce Access Control to Data through Automated Tools |      |      | X    |
