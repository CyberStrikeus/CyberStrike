---
name: cis-azure-foundations-5.2.3
description: "Ensure an exclusionary device code flow policy is considered"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, conditional-access]
cis_id: "5.2.3"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.2.2, cis-azure-foundations-5.2.4]
prerequisites: []
severity_boost: {}
---

# Ensure an exclusionary device code flow policy is considered

## Description

Conditional Access Policies can be used to prevent the Device code authentication flow. Device code flow should be permitted only for users that regularly perform duties that explicitly require the use of Device Code to authenticate, such as utilizing Azure with PowerShell.

## Rationale

Attackers use Device code flow in phishing attacks and, if successful, results in the attacker gaining access tokens and refresh tokens which are scoped to "user_impersonation", which can perform any action the user has permission to perform.

## Impact

Microsoft Entra ID P1 or P2 is required.

This policy should be tested using the `Report-only mode` before implementation. Without a full and careful understanding of the accounts and personnel who require Device code authentication flow, implementing this policy can block authentication for users and devices who rely on Device code flow. For users and devices that rely on device code flow authentication, more secure alternatives should be implemented wherever possible.

## Audit Procedure

### Using Azure Portal

1. From Azure Home open the Portal menu in the top left and select `Microsoft Entra ID`.
2. Scroll down in the menu on the left and select `Security`.
3. Select on the left side `Conditional Access`.
4. Select `Policies`.
5. Select the policy you wish to audit, then:
   - Under `Assignments` > `Users`, review the users and groups for the personnel the policy will apply to.
   - Under `Assignments` > `Target resources`, review the cloud apps or actions for the systems the policy will apply to.
   - Under `Conditions` > `Authentication Flows`, review the configuration to ensure `Device code flow` is selected.
   - Under `Access Controls` > `Grant` - Confirm that `Block access` is selected.

## Expected Result

At least one Conditional Access policy should exist that blocks the Device code authentication flow, targeting all users with appropriate exclusions for emergency access accounts.

## Remediation

### Remediate from Azure Portal

Part 1 of 2 - Create the policy and enable it in `Report-only` mode.

1. From Azure Home open the portal menu in the top left and select `Microsoft Entra ID`.
2. Scroll down in the menu on the left and select `Security`.
3. Select on the left side `Conditional Access`.
4. Select `Policies`.
5. Click the `+ New policy` button, then:
6. Provide a name for the policy.
7. Under `Assignments`, select `Users` then:
   - Under `Include`, select `All users`.
   - Under `Exclude`, check Users and groups and only select emergency access accounts.
8. Under `Assignments`, select `Target resources` then:
   - Under `Include`, select `All cloud apps`.
   - Leave `Exclude` blank unless you have a well defined exception.
9. Under `Conditions` > `Authentication Flows`, set Configure to `Yes` then:
   - Select `Device code flow`.
   - Select `Done`.
10. Under `Access Controls` > `Grant`, select `Block Access`.
11. Set `Enable policy` to `Report-only`.
12. Click `Create`.

Allow some time to pass to ensure the sign-in logs capture relevant conditional access events. These events will need to be reviewed to determine if additional considerations are necessary for your organization (e.g. many legitimate use cases of device code authentication are observed).

NOTE: The policy is not yet 'live,' since `Report-only` is being used to audit the effect of the policy.

Part 2 of 2 - Confirm that the policy is not blocking access that should be granted, then toggle to `On`.

1. With your policy now in report-only mode, return to the Microsoft Entra blade and click on `Sign-in logs`.
2. Review the recent sign-in events - click an event then review the event details (specifically the `Report-only` tab) to ensure:
   - The sign-in event you're reviewing occurred **after** turning on the policy in report-only mode.
   - The policy name from step 6 above is listed in the `Policy Name` column.
   - The `Result` column for the new policy shows that the policy was `Not applied` (indicating the device code authentication flow was not blocked).
3. If the above conditions are present, navigate back to the policy name in Conditional Access and open it.
4. Toggle the policy from `Report-only` to `On`.
5. Click `Save`.

## Default Value

This policy does not exist by default.

## References

1. https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-authentication-flows#device-code-flow
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-identity-management#im-7-restrict-resource-access-based-on--conditions
3. https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-report-only
4. https://learn.microsoft.com/en-us/entra/identity/conditional-access/policy-block-authentication-flows

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
| ---------------- | ------- | ---- | ---- | ---- |
| v8 | 6.1 Establish an Access Granting Process | x | x | x |
| v7 | 12.4 Deny Communication over Unauthorized Ports | x | x | x |

## Profile

Level 2 | Manual
