---
name: cis-azure-foundations-5.3.1
description: "Ensure Azure admin accounts are not used for daily operations"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, identity-reviews]
cis_id: "5.3.1"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.3.2, cis-azure-foundations-5.3.4]
prerequisites: []
severity_boost: {}
---

# Ensure Azure admin accounts are not used for daily operations

## Description

Microsoft Azure admin accounts should not be used for routine, non-administrative tasks.

## Rationale

Using admin accounts for daily operations increases the risk of accidental misconfigurations and security breaches.

## Impact

Minor administrative overhead includes managing separate accounts, enforcing stricter access controls, and potential licensing costs for advanced security features.

## Audit Procedure

### Using Azure Portal

**Monitor:**

1. Go to `Monitor`.
2. Click `Activity log`.
3. Review the activity log and ensure that admin accounts are not being used for daily operations.

**Microsoft Entra ID:**

1. Go to `Microsoft Entra ID`.
2. Under `Monitoring`, click `Sign-in logs`.
3. Review the sign-in logs and ensure that admin accounts are not being accessed more frequently than necessary.

## Expected Result

Admin accounts should show minimal sign-in activity limited to administrative tasks only. Regular daily operations should be performed using non-privileged user accounts.

## Remediation

If admin accounts are being used for daily operations, consider the following:

- Monitor and alert on unusual activity.
- Enforce the principle of least privilege.
- Revoke any unnecessary administrative access.
- Use Conditional Access to limit access to resources.
- Ensure that administrators have separate admin and user accounts.
- Use Microsoft Entra ID Protection to detect, investigate, and remediate identity-based risks.
- Use Privileged Identity Management (PIM) in Microsoft Entra ID to limit standing administrator access to privileged roles, discover who has access, and review privileged access.

## Default Value

There is no default enforcement preventing admin accounts from being used for daily operations.

## References

1. https://learn.microsoft.com/en-us/security/privileged-access-workstations/critical-impact-accounts

## CIS Controls

| Controls Version | Control                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | x    | x    | x    |
| v7               | 4.3 Ensure the Use of Dedicated Administrative Accounts                   | x    | x    | x    |

## Profile

Level 1 | Manual
