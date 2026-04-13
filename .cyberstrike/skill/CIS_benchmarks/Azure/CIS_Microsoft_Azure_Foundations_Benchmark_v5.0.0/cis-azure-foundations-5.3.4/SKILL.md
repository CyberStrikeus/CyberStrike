---
name: cis-azure-foundations-5.3.4
description: "Ensure all 'privileged' role assignments are periodically reviewed"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, identity-reviews]
cis_id: "5.3.4"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.3.3, cis-azure-foundations-5.3.5]
prerequisites: []
severity_boost: {}
---

# Ensure all 'privileged' role assignments are periodically reviewed

## Description

Periodic review of privileged role assignments is performed to ensure that the privileged roles assigned to users are accurate and appropriate.

## Rationale

Privileged roles are crown jewel assets that can be used by malicious insiders, threat actors, and even through mistake to significantly damage an organization in numerous ways. These roles should be periodically reviewed to:

- Identify lingering permissions assignment (e.g. an administrator has been terminated, the administrator account is being retained, but the permissions are no longer necessary and has not been properly addressed by process).
- Detect lateral movement through privilege escalation (e.g. an account with administrative permission has been compromised and is elevating other accounts in an attempt to circumvent detection mechanisms).

## Impact

Increased administrative effort to manage and remove role assignments appropriately.

## Audit Procedure

### Using Azure Portal

1. From Azure Home select the Portal Menu.
2. Select `Subscriptions`.
3. Select a subscription.
4. Select `Access control (IAM)`.
5. Look for the number under the word `Privileged` accompanied by a link titled `View Assignments`. Click the `View assignments` link.
6. For each privileged role listed, evaluate whether the assignment is appropriate and current for each User, Group, or App assigned to each privileged role.

NOTE: The judgement of what constitutes 'appropriate and current' assignments requires a clear understanding of your organization's personnel, systems, policy, and security requirements. This cannot be effectively prescribed in procedure.

## Expected Result

All privileged role assignments should be appropriate, current, and justified. No lingering or unnecessary privileged role assignments should exist.

## Remediation

Review and remove any inappropriate or unnecessary privileged role assignments. Use Privileged Identity Management (PIM) where available to enforce just-in-time access for privileged roles.

## Default Value

Privileged role assignments are not automatically reviewed.

## References

1. https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
| ---------------- | ------- | ---- | ---- | ---- |
| v8 | 6.8 Define and Maintain Role-Based Access Control | | | x |
| v7 | 4.1 Maintain Inventory of Administrative Accounts | | x | x |

## Profile

Level 1 | Manual
