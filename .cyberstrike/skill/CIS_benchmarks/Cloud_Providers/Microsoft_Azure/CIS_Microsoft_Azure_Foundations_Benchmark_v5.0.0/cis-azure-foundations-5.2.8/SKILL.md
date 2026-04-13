---
name: cis-azure-foundations-5.2.8
description: "Ensure a Token Protection Conditional Access policy is considered"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, conditional-access]
cis_id: "5.2.8"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.2.7, cis-azure-foundations-5.2.4]
prerequisites: []
severity_boost: {}
---

# Ensure a Token Protection Conditional Access policy is considered

## Description

This recommendation ensures that issued tokens are only issued to the intended device.

## Rationale

When properly configured, conditional access can aid in preventing attacks involving token theft, via hijacking or reply, as part of the attack flow. Although currently considered a rare event, the impact from token impersonation can be severe.

## Impact

A Microsoft Entra ID P1 or P2 license is required.

Start with a Conditional Access policy in "Report Only" mode prior to enforcing for all users.

## Audit Procedure

### Using Azure Portal

1. Sign in to the Microsoft Entra admin center as at least a `Conditional Access Administrator`.
2. Browse to `Protection` > `Conditional Access` > `Policies`.
3. Review existing policies to ensure that at least one policy contains the following configuration:
4. Under `Assignments`, review `Users or workload identities` and
   - Under `Include`, ensure the scope of the users or groups is appropriate for your organization.
   - Under `Exclude`, ensure only necessary users and groups (your organization's emergency access or break-glass accounts) are excepted.
5. Under `Target resources` > `Resources` > `Include` > `Select resources`: Ensure that both `Office 365 Exchange Online` and `Office 365 SharePoint Online` are selected.
6. Under `Conditions` > `Device Platforms`: Ensure `Configure` is set to `Yes` and `Include` indicates `Windows` platforms.
7. Under `Conditions` > `Client Apps`: Ensure `Configure` is set to `Yes` and `Mobile Apps and Desktop Clients` is selected under Modern Authentication Clients.
8. Under `Access controls` > `Session`, ensure that `Require token protection for sign-in sessions` is selected.

## Expected Result

At least one Conditional Access policy should exist with Token Protection configured, targeting Office 365 Exchange Online and SharePoint Online on Windows platforms with mobile apps and desktop clients.

## Remediation

### Remediate from Azure Portal

1. Sign in to the Microsoft Entra admin center as at least a `Conditional Access Administrator`.
2. Browse to `Protection` > `Conditional Access` > `Policies`.
3. Select `New policy`.
4. Give your policy a name.
5. Under `Assignments`, select `Users or workload identities`.
   1. Under `Include`, select the users or groups to apply this policy.
   2. Under `Exclude`, select Users and groups and choose your organization's emergency access or break-glass accounts (if applicable).
6. Under `Target resources` > `Resources` > `Include` > `Select resources`
   1. Under `Select`, select the following applications:
      1. Office 365 Exchange Online
      2. Office 365 SharePoint Online
   2. Choose `Select`.
7. Under `Conditions`:
   1. Under `Device platforms`
      1. Set `Configure` to Yes.
      2. `Include` > `Select device platforms` > `Windows`.
      3. Select `Done`.
   2. Under `Client apps`:
      1. Set `Configure` to Yes.
      2. Under Modern authentication clients, only select `Mobile apps and desktop clients`.
      3. Select `Done`.
8. Under `Access controls` > `Session`, select `Require token protection for sign-in sessions` and select `Select`.
9. Confirm your settings and set Enable policy to `On`.
10. Select `Create` to enable your policy.

## Default Value

A Token Protection Conditional Access policy does not exist by default.

## References

1. https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-token-protection
2. https://www.microsoft.com/en-gb/security/business/microsoft-entra-pricing

## CIS Controls

| Controls Version | Control                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.3 Require MFA for Externally-Exposed Applications |      | x    | x    |
| v8               | 6.4 Require MFA for Remote Network Access           | x    | x    | x    |

## Profile

Level 2 | Manual
