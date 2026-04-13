---
name: cis-azure-foundations-5.8
description: "Ensure 'Custom banned password list' is set to 'Enforce'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, password-policy, banned-passwords, password-protection]
cis_id: "5.8"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.6, cis-azure-foundations-5.7]
prerequisites: []
severity_boost: {}
---

# Ensure 'Custom banned password list' is set to 'Enforce'

## Description

Microsoft Azure applies a default global banned password list to all user and admin accounts that are created and managed directly in Microsoft Entra ID. The Microsoft Entra password policy does not apply to user accounts that are synchronized from an on-premises Active Directory environment, unless Microsoft Entra ID Connect is used and `EnforceCloudPasswordPolicyForPasswordSyncedUsers` is enabled. For increased password security, a custom banned password list is recommended.

## Rationale

Implementing a custom banned password list gives your organization further control over the password policy. Disallowing easy-to-guess passwords increases the security of your Azure resources.

## Impact

Increasing password complexity may increase user account administration overhead. Utilizing the default global banned password list and a custom list requires a Microsoft Entra ID P1 or P2 license. On-premises Active Directory Domain Services users who aren't synchronized to Microsoft Entra ID still benefit from Microsoft Entra ID Password Protection based on the existing licensing of synchronized users.

## Audit Procedure

### Using Azure Portal

1. From Azure Home select the Portal Menu.
2. Select `Microsoft Entra ID`.
3. Under `Manage`, select `Security`.
4. Under `Manage`, select `Authentication methods`.
5. Under `Manage`, select `Password protection`.
6. Ensure `Enforce custom list` is set to `Yes`.
7. Review the list of words banned from use in passwords.

## Expected Result

`Enforce custom list` should be set to `Yes` and the custom banned password list should contain organization-specific terms.

## Remediation

### Using Azure Portal

1. From Azure Home select the Portal Menu.
2. Select `Microsoft Entra ID`.
3. Under `Manage`, select `Security`.
4. Under `Manage`, select `Authentication methods`.
5. Under `Manage`, select `Password protection`.
6. Set the `Enforce custom list` option to `Yes`.
7. Click in the `Custom banned password list` text box.
8. Add a list of words, one per line, to prevent users from using in passwords.
9. Click `Save`.

## Default Value

By default the custom banned password list is not 'Enabled'. Organization-specific terms can be added to the custom banned password list, such as brand names, product names, locations, company-specific terms, abbreviations, and months/weekdays with your company's local languages.

## References

1. https://learn.microsoft.com/en-us/entra/identity/authentication/concept-password-ban-bad-combined-policy
2. https://learn.microsoft.com/en-us/entra/identity/authentication/concept-password-ban-bad
3. https://learn.microsoft.com/en-us/powershell/module/azuread/
4. https://www.microsoft.com/en-us/research/publication/password-guidance/
5. https://learn.microsoft.com/en-us/entra/identity/authentication/tutorial-configure-custom-password-protection
6. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-identity-management#im-6-use-strong-authentication-controls

## CIS Controls

| Controls Version | Control                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------- | ---- | ---- | ---- |
| v8               | 5.2 Use Unique Passwords      | x    | x    | x    |
| v8               | 6.7 Centralize Access Control |      | x    | x    |
| v7               | 4.4 Use Unique Passwords      |      | x    | x    |

## Profile

Level 1 | Manual
