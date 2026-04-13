---
name: cis-azure-foundations-5.2.2
description: "Ensure an exclusionary geographic Conditional Access policy is considered"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, conditional-access]
cis_id: "5.2.2"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.2.1, cis-azure-foundations-5.2.3]
prerequisites: []
severity_boost: {}
---

# Ensure an exclusionary geographic Conditional Access policy is considered

## Description

CAUTION: If these policies are created without first auditing and testing the result, misconfiguration can potentially lock out administrators or create undesired access issues.

Conditional Access Policies can be used to block access from geographic locations that are deemed out-of-scope for your organization or application. The scope and variables for this policy should be carefully examined and defined.

## Rationale

Conditional Access, when used as a deny list for the tenant or subscription, is able to prevent ingress or egress of traffic to countries that are outside of the scope of interest (e.g.: customers, suppliers) or jurisdiction of an organization. This is an effective way to prevent unnecessary and long-lasting exposure to international threats such as APTs.

Note on Assessment Status: Because the determination of entities to be included or excluded is specific and unique to each organization, assessment status for this recommendation is considered 'Manual' even though some elements for automation (CLI, PowerShell) are provided.

## Impact

Microsoft Entra ID P1 or P2 is required. Limiting access geographically will deny access to users that are traveling or working remotely in a different part of the world. A point-to-site or site to site tunnel such as a VPN is recommended to address exceptions to geographic access policies.

## Audit Procedure

### Using Azure Portal

1. From Azure Home open the Portal menu in the top left, and select `Microsoft Entra ID`.
2. Scroll down in the menu on the left, and select `Security`.
3. Select on the left side `Conditional Access`.
4. Select `Policies`.
5. Select the policy you wish to audit, then:
   - Under `Assignments` > `Users`, review the users and groups for the personnel the policy will apply to.
   - Under `Assignments` > `Target resources`, review the cloud apps or actions for the systems the policy will apply to.
   - Under `Conditions` > `Locations`, Review the `Include` locations for those that should be **blocked**.
   - Under `Conditions` > `Locations`, Review the `Exclude` locations for those that should be allowed (Note: locations set up in the previous recommendation for Trusted Location should be in the `Exclude` list.)
   - Under `Access Controls` > `Grant` - Confirm that `Block access` is selected.

### Using Azure CLI

As of this writing there are no subcommands for Conditional Access Policies within the Azure CLI.

### Using PowerShell

```powershell
$conditionalAccessPolicies = Get-MgIdentityConditionalAccessPolicy

foreach($policy in $conditionalAccessPolicies) {$policy | Select-Object @{N='Policy ID'; E={$policy.id}}, @{N="Included Locations"; E={$policy.Conditions.Locations.IncludeLocations}}, @{N="Excluded Locations"; E={$policy.Conditions.Locations.ExcludeLocations}}, @{N="BuiltIn GrantControls"; E={$policy.GrantControls.BuiltInControls}}}
```

Make sure there is at least 1 row in the output of the above PowerShell command that contains `Block` under the `BuiltIn GrantControls` column and location IDs under the `Included Locations` and `Excluded Locations` columns. If not, a policy containing these options has not been created and is considered a finding.

## Expected Result

At least one Conditional Access policy should exist with geographic location restrictions configured, blocking access from countries outside the organization's scope and excluding trusted locations.

## Remediation

### Remediate from Azure Portal

Part 1 of 2 - Create the policy and enable it in `Report-only` mode.

1. From Azure Home open the portal menu in the top left, and select `Microsoft Entra ID`.
2. Scroll down in the menu on the left, and select `Security`.
3. Select on the left side `Conditional Access`.
4. Select `Policies`.
5. Click the `+ New policy` button, then:
6. Provide a name for the policy.
7. Under `Assignments`, select `Users` then:
   - Under `Include`, select `All users`.
   - Under `Exclude`, check Users and groups and only select emergency access accounts and service accounts (NOTE: Service accounts are excluded here because service accounts are non-interactive and cannot complete MFA).
8. Under `Assignments`, select `Target resources` then:
   - Under `Include`, select `All cloud apps`.
   - Leave `Exclude` blank unless you have a well defined exception.
9. Under `Conditions`, select `Locations` then:
   - Select `Include`, then add entries for locations for those that should be **blocked**.
   - Select `Exclude`, then add entries for those that should be allowed (IMPORTANT: Ensure that all Trusted Locations are in the `Exclude` list.)
10. Under `Access Controls`, select `Grant` select `Block Access`.
11. Set `Enable policy` to `Report-only`.
12. Click `Create`.

Allow some time to pass to ensure the sign-in logs capture relevant conditional access events. These events will need to be reviewed to determine if additional considerations are necessary for your organization (e.g. legitimate locations are being blocked and investigation is needed for exception).

NOTE: The policy is not yet 'live,' since `Report-only` is being used to audit the effect of the policy.

Part 2 of 2 - Confirm that the policy is not blocking access that should be granted, then toggle to `On`.

1. With your policy now in report-only mode, return to the Microsoft Entra blade and click on `Sign-in logs`.
2. Review the recent sign-in events - click an event then review the event details (specifically the `Report-only` tab) to ensure:
   - The sign-in event you're reviewing occurred **after** turning on the policy in report-only mode.
   - The policy name from step 6 above is listed in the `Policy Name` column.
   - The `Result` column for the new policy shows that the policy was `Not applied` (indicating the location origin was not blocked).
3. If the above conditions are present, navigate back to the policy name in Conditional Access and open it.
4. Toggle the policy from `Report-only` to `On`.
5. Click `Save`.

### Remediate from PowerShell

First, set up the conditions objects values before updating an existing conditional access policy or before creating a new one. You may need to use additional PowerShell cmdlets such as the `Get-MgIdentityConditionalAccessNamedLocation` which outputs the `Location IDs` for use with conditional access policies.

```powershell
$conditions = New-Object -TypeName Microsoft.Open.MSGraph.Model.ConditionalAccessConditionSet
$conditions.Applications = New-Object -TypeName Microsoft.Open.MSGraph.Model.ConditionalAccessApplicationCondition
$conditions.Applications.IncludeApplications = <"All" | "Office365" | "app ID" | @("app ID 1", "app ID 2", etc...)>
$conditions.Users = New-Object -TypeName Microsoft.Open.MSGraph.Model.ConditionalAccessUserCondition
$conditions.Users.IncludeUsers = <"All" | "None" | "GuestsOrExternalUsers" | "Specific User ID" | @("User ID 1", "User ID 2", etc.)>
$conditions.Locations = New-Object -TypeName Microsoft.Open.MSGraph.Model.ConditionalAccessLocationCondition
$conditions.Locations.IncludeLocations = <"Location ID" | @("Location ID 1", "Location ID 2", etc...)>
$conditions.Locations.ExcludeLocations = <"AllTrusted" | "Location ID" | @("Location ID 1", "Location ID 2", etc...)>

$controls = New-Object -TypeName Microsoft.Open.MSGraph.Model.ConditionalAccessGrantControls
$controls._Operator = "OR"
$controls.BuiltInControls = "block"
```

Next, update the existing conditional access policy with the condition set options configured with the previous commands:

```powershell
Update-MgIdentityConditionalAccessPolicy -PolicyId <policy ID> -Conditions $conditions -GrantControls $controls
```

To create a new conditional access policy that complies with this best practice, run the following command after creating the condition set above:

```powershell
New-MgIdentityConditionalAccessPolicy -Name "Policy Name" -State <enabled|disabled> -Conditions $conditions -GrantControls $controls
```

## Default Value

This policy does not exist by default.

## References

1. https://learn.microsoft.com/en-us/entra/identity/conditional-access/policy-block-by-location
2. https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-report-only
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-identity-management#im-7-restrict-resource-access-based-on--conditions

## CIS Controls

| Controls Version | Control                                          | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------ | ---- | ---- | ---- |
| v8               | 6.7 Centralize Access Control                    |      | x    | x    |
| v7               | 12.1 Maintain an Inventory of Network Boundaries | x    | x    | x    |

## Profile

Level 2 | Manual
