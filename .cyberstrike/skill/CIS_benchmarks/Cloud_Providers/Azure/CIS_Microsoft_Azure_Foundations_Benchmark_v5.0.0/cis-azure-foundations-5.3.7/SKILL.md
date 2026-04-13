---
name: cis-azure-foundations-5.3.7
description: "Ensure all non-privileged role assignments are periodically reviewed"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, identity-reviews]
cis_id: "5.3.7"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.3.4, cis-azure-foundations-5.3.6]
prerequisites: []
severity_boost: {}
---

# Ensure all non-privileged role assignments are periodically reviewed

## Description

Perform a periodic review of non-privileged role assignments to ensure that the non-privileged roles assigned to users are appropriate.

Note: Determining 'appropriate' assignments requires a clear understanding of your organization's personnel, systems, policies, and security requirements. This cannot be effectively prescribed in a procedure.

## Rationale

To ensure the principle of least privilege is followed, non-privileged role assignments should be reviewed periodically to confirm that users are granted only the minimum level of permissions they need to perform their tasks.

## Impact

Increased administrative effort to manage and remove role assignments appropriately.

## Audit Procedure

### Using Azure Portal

1. Go to `Subscriptions`.
2. Click the name of a subscription.
3. Click `Access control (IAM)`.
4. Click `Role assignments`.
5. Click `Job function roles`.
6. For each role, ensure the assignments are appropriate.
7. Repeat steps 1-6 for each subscription.

## Expected Result

All non-privileged role assignments should be appropriate and justified. No unnecessary or outdated role assignments should exist.

## Remediation

### Remediate from Azure Portal

1. Go to `Subscriptions`.
2. Click the name of a subscription.
3. Click `Access control (IAM)`.
4. Click `Role assignments`.
5. Click `Job function roles`.
6. Check the box next to any inappropriate assignments.
7. Click `Delete`.
8. Click `Yes`.
9. Repeat steps 1-8 for each subscription.

## Default Value

Users do not have non-privileged roles assigned to them by default.

## References

1. https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.8 Define and Maintain Role-Based Access Control |      |      | x    |
| v7               | 16.6 Maintain an Inventory of Accounts            |      | x    | x    |

## Profile

Level 1 | Manual
