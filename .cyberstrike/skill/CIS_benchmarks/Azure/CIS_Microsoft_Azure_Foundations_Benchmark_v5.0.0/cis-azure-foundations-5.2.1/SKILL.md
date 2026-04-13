---
name: cis-azure-foundations-5.2.1
description: "Ensure 'trusted locations' are defined"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, conditional-access]
cis_id: "5.2.1"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.2.2, cis-azure-foundations-5.2.4]
prerequisites: []
severity_boost: {}
---

# Ensure 'trusted locations' are defined

## Description

Microsoft Entra ID Conditional Access allows an organization to configure `Named locations` and configure whether those locations are trusted or untrusted. These settings provide organizations the means to specify Geographical locations for use in conditional access policies, or define actual IP addresses and IP ranges and whether or not those IP addresses and/or ranges are trusted by the organization.

## Rationale

Defining trusted source IP addresses or ranges helps organizations create and enforce Conditional Access policies around those trusted or untrusted IP addresses and ranges. Users authenticating from trusted IP addresses and/or ranges may have less access restrictions or access requirements when compared to users that try to authenticate to Microsoft Entra ID from untrusted locations or untrusted source IP addresses/ranges.

Note on Assessment Status: Because the determination of entities to be included or excluded is specific and unique to each organization, assessment status for this recommendation is considered 'Manual' even though some elements for automation (CLI, PowerShell) are provided.

## Impact

When configuring `Named locations`, the organization can create locations using Geographical location data or by defining source IP addresses or ranges. Configuring `Named locations` using a Country location does not provide the organization the ability to mark those locations as trusted, and any Conditional Access policy relying on those `Countries location` setting will not be able to use the `All trusted locations` setting within the Conditional Access policy. They instead will have to rely on the `Select locations` setting. This may add additional resource requirements when configuring and will require thorough organizational testing.

In general, Conditional Access policies may completely prevent users from authenticating to Microsoft Entra ID, and thorough testing is recommended. To avoid complete lockout, a 'Break Glass' account with full Global Administrator rights is recommended in the event all other administrators are locked out of authenticating to Microsoft Entra ID. This 'Break Glass' account should be excluded from Conditional Access Policies and should be configured with the longest pass phrase feasible in addition to a FIDO2 security key or certificate kept in a very secure physical location. This account should only be used in the event of an emergency and complete administrator lockout.

NOTE: Starting July 2024, Microsoft will begin requiring MFA for All Users - including Break Glass Accounts. Physical FIDO2 security keys, or a certificate kept on secure removable storage can fulfill this MFA requirement.

## Audit Procedure

### Using Azure Portal

1. In the Azure Portal, navigate to `Microsoft Entra ID`.
2. Under `Manage`, click `Security`.
3. Under `Protect`, click `Conditional Access`.
4. Under `Manage`, click `Named locations`.

Ensure there are `IP ranges location` settings configured and marked as `Trusted`.

### Using PowerShell

```powershell
Get-MgIdentityConditionalAccessNamedLocation
```

In the output from the above command, for each Named location group, make sure at least one entry contains the `IsTrusted` parameter with a value of `True`. Otherwise, if there is no output as a result of the above command or all of the entries contain the `IsTrusted` parameter with an empty value, a `NULL` value, or a value of `False`, the results are out of compliance with this check.

## Expected Result

At least one Named location should exist with `IsTrusted` set to `True`, indicating trusted IP ranges are defined for the organization.

## Remediation

### Remediate from Azure Portal

1. In the Azure Portal, navigate to `Microsoft Entra ID`.
2. Under `Manage`, click `Security`.
3. Under `Protect`, click `Conditional Access`.
4. Under `Manage`, click `Named locations`.
5. Within the `Named locations` blade, click on `IP ranges location`.
6. Enter a name for this location setting in the `Name` text box.
7. Click on the `+` sign.
8. Add an IP Address Range in CIDR notation inside the text box that appears.
9. Click on the `Add` button.
10. Repeat steps 7 through 9 for each IP Range that needs to be added.
11. If the information entered are trusted ranges, select the `Mark as trusted location` check box.
12. Once finished, click on `Create`.

### Remediate from PowerShell

Create a new trusted IP-based Named location policy:

```powershell
[System.Collections.Generic.List`1[Microsoft.Open.MSGraph.Model.IpRange]]$ipRanges = @()
$ipRanges.Add("<first IP range in CIDR notation>")
$ipRanges.Add("<second IP range in CIDR notation>")
$ipRanges.Add("<third IP range in CIDR notation>")
New-MgIdentityConditionalAccessNamedLocation -dataType "#microsoft.graph.ipNamedLocation" -DisplayName "<name of IP Named location policy>" -IsTrusted $true -IpRanges $ipRanges
```

Set an existing IP-based Named location policy to trusted:

```powershell
Update-MgIdentityConditionalAccessNamedLocation -PolicyId "<ID of the policy>" -dataType "#microsoft.graph.ipNamedLocation" -IsTrusted $true
```

## Default Value

By default, no locations are configured under the `Named locations` blade within the Microsoft Entra ID Conditional Access blade.

## References

1. https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-assignment-network
2. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-identity-management#im-7-restrict-resource-access-based-on--conditions
3. https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-emergency-access

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
| ---------------- | ------- | ---- | ---- | ---- |
| v8 | 6.7 Centralize Access Control | | x | x |
| v8 | 12.2 Establish and Maintain a Secure Network Architecture | | x | x |
| v7 | 11.1 Maintain Standard Security Configurations for Network Devices | | x | x |

## Profile

Level 2 | Manual
