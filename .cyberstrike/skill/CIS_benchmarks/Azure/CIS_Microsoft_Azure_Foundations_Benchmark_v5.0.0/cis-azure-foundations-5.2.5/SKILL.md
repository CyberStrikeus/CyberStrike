---
name: cis-azure-foundations-5.2.5
description: "Ensure multifactor authentication is required for risky sign-ins"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, conditional-access]
cis_id: "5.2.5"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.2.4, cis-azure-foundations-5.2.6]
prerequisites: []
severity_boost: {}
---

# Ensure multifactor authentication is required for risky sign-ins

## Description

Entra ID tracks the behavior of sign-in events. If the Entra ID domain is licensed with P2, the sign-in behavior can be used as a detection mechanism for additional scrutiny during the sign-in event. If this policy is set up, then Risky Sign-in events will prompt users to use multi-factor authentication (MFA) tokens on login for additional verification.

## Rationale

Enabling multi-factor authentication is a recommended setting to limit the potential of accounts being compromised and limiting access to authenticated personnel. Enabling this policy allows Entra ID's risk-detection mechanisms to force additional scrutiny on the login event, providing a deterrent response to potentially malicious sign-in events, and adding an additional authentication layer as a reaction to potentially malicious behavior.

## Impact

Risk Policies for Conditional Access require Microsoft Entra ID P2. Additional overhead to support or maintain these policies may also be required if users lose access to their MFA tokens.

## Audit Procedure

### Using Azure Portal

1. From Azure Home select the Portal Menu in the top left and select `Microsoft Entra ID`.
2. Select `Security`.
3. Select on the left side `Conditional Access`.
4. Select `Policies`.
5. Select the policy you wish to audit.
6. Click the blue text under `Users`.
7. View under `Include` the corresponding users and groups to whom the policy is applied.
8. View under `Exclude` to determine which users and groups to whom the policy is not applied.

## Expected Result

A Conditional Access policy should exist that requires MFA for risky sign-ins, targeting all users with all cloud apps, with sign-in risk conditions set to High and Medium, and the Grant control set to `Require multifactor authentication` with sign-in frequency set to `Every time`.

## Remediation

### Remediate from Azure Portal

1. From Azure Home select the Portal Menu in the top left and select `Microsoft Entra ID`.
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
13. Click the blue text under `Conditions`.
14. Select `Sign-in risk`.
15. Update the `Configure` toggle to `Yes`.
16. Check the sign-in risk level this policy should apply to, e.g. `High` and `Medium`.
17. Select `Done`.
18. Click the blue text under `Grant` and check `Require multifactor authentication` then click the `Select` button.
19. Click the blue text under `Session` then check `Sign-in frequency` and select `Every time` and click the `Select` button.
20. Set `Enable policy` to `Report-only`.
21. Click `Create`.

After testing the policy in report-only mode, update the `Enable policy` setting from `Report-only` to `On`.

## Default Value

MFA is not enabled by default.

## References

1. https://learn.microsoft.com/en-us/entra/identity/conditional-access/policy-risk-based-sign-in
2. https://learn.microsoft.com/en-us/entra/identity/conditional-access/troubleshoot-conditional-access-what-if
3. https://learn.microsoft.com/en-us/entra/identity/conditional-access/howto-conditional-access-insights-reporting
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-identity-management#im-7-restrict-resource-access-based-on--conditions
5. https://learn.microsoft.com/en-us/entra/id-protection/overview-identity-protection#license-requirements

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
| ---------------- | ------- | ---- | ---- | ---- |
| v8 | 6.3 Require MFA for Externally-Exposed Applications | | x | x |
| v8 | 6.4 Require MFA for Remote Network Access | x | x | x |
| v8 | 6.7 Centralize Access Control | | x | x |
| v7 | 16.3 Require Multi-factor Authentication | | x | x |

## Profile

Level 2 | Manual
