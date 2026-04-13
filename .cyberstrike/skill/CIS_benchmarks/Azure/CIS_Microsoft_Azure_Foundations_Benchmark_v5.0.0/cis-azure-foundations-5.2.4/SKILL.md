---
name: cis-azure-foundations-5.2.4
description: "Ensure a multifactor authentication policy exists for all users"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, conditional-access]
cis_id: "5.2.4"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.2.5, cis-azure-foundations-5.2.6]
prerequisites: []
severity_boost: {}
---

# Ensure a multifactor authentication policy exists for all users

## Description

A Conditional Access policy can be enabled to ensure that users are required to use Multifactor Authentication (MFA) to login.

Note: Since 2024, Azure has been rolling out mandatory multifactor authentication. For more information:

- https://azure.microsoft.com/en-us/blog/announcing-mandatory-multi-factor-authentication-for-azure-sign-in
- https://learn.microsoft.com/en-us/entra/identity/authentication/concept-mandatory-multifactor-authentication

## Rationale

Multifactor authentication is strongly recommended to increase the confidence that a claimed identity can be proven to be the subject of the identity. This results in a stronger authentication chain and reduced likelihood of exploitation.

## Impact

There is an increased cost associated with Conditional Access policies because of the requirement of Microsoft Entra ID P1 or P2 licenses. Additional support overhead may also need to be considered.

## Audit Procedure

### Using Azure Portal

1. From Azure Home open the Portal Menu in the top left, and select `Microsoft Entra ID`.
2. Scroll down in the menu on the left, and select `Security`.
3. Select on the left side `Conditional Access`.
4. Select `Policies`.
5. Select the policy you wish to audit.
6. Click the blue text under `Users`.
7. Under `Include` ensure that `All Users` is specified.
8. Under `Exclude` ensure that no users or groups are specified. If there are users or groups specified for exclusion, a very strong justification should exist for each exception, and all excepted account-level objects should be recorded in documentation along with the justification for comparison in future audits.

## Expected Result

A Conditional Access policy should exist that requires MFA for all users, targeting all cloud apps, with the Grant control set to `Require multifactor authentication`.

## Remediation

### Remediate from Azure Portal

1. From Azure Home open Portal menu in the top left, and select `Microsoft Entra ID`.
2. Select `Security`.
3. Select `Conditional Access`.
4. Select `Policies`.
5. Click `+ New policy`.
6. Enter a name for the policy.
7. Click the blue text under `Users`.
8. Under `Include`, select `All users`.
9. Under `Exclude`, check `Users and groups`.
10. Select users this policy should not apply to and click `Select`.
11. Click the blue text under `Target resources`.
12. Select `All cloud apps`.
13. Click the blue text under `Grant`.
14. Under `Grant access`, check `Require multifactor authentication` and click `Select`.
15. Set `Enable policy` to `Report-only`.
16. Click `Create`.

After testing the policy in report-only mode, update the `Enable policy` setting from `Report-only` to `On`.

## Default Value

Starting October 2024, MFA will be required for all accounts by default.

## References

1. https://learn.microsoft.com/en-us/entra/identity/conditional-access/policy-all-users-mfa-strength
2. https://learn.microsoft.com/en-us/entra/identity/conditional-access/troubleshoot-conditional-access-what-if
3. https://learn.microsoft.com/en-us/entra/identity/conditional-access/howto-conditional-access-insights-reporting
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-identity-management#im-7-restrict-resource-access-based-on--conditions

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
| ---------------- | ------- | ---- | ---- | ---- |
| v8 | 6.3 Require MFA for Externally-Exposed Applications | | x | x |
| v8 | 6.4 Require MFA for Remote Network Access | x | x | x |
| v7 | 4.5 Use Multifactor Authentication For All Administrative Access | | x | x |
| v7 | 16.3 Require Multi-factor Authentication | | x | x |

## Profile

Level 2 | Manual
