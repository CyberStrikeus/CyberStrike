---
name: cis-azure-foundations-5.1.1
description: "Ensure 'security defaults' is enabled in Microsoft Entra ID"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, mfa]
cis_id: "5.1.1"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.1.2, cis-azure-foundations-5.1.3]
prerequisites: []
severity_boost: {}
---

# Ensure 'security defaults' is enabled in Microsoft Entra ID

## Description

[IMPORTANT - Please read the section overview: If your organization pays for Microsoft Entra ID licensing (included in Microsoft 365 E3, E5, F5, or Business Premium, and EM&S E3 or E5 licenses) and CAN use Conditional Access, ignore the recommendations in this section and proceed to the Conditional Access section.]

Security defaults in Microsoft Entra ID make it easier to be secure and help protect your organization. Security defaults contain preconfigured security settings for common attacks.

Security defaults is available to everyone. The goal is to ensure that all organizations have a basic level of security enabled at no extra cost. You may turn on security defaults in the Azure portal.

## Rationale

Security defaults provide secure default settings that we manage on behalf of organizations to keep customers safe until they are ready to manage their own identity security settings.

For example, doing the following:

- Requiring all users and admins to register for MFA.
- Challenging users with MFA - when necessary, based on factors such as location, device, role, and task.
- Disabling authentication from legacy authentication clients, which cannot do MFA.

## Impact

This recommendation should be implemented initially and then may be overridden by other service/product specific CIS Benchmarks. Administrators should also be aware that certain configurations in Microsoft Entra ID may impact other Microsoft services such as Microsoft 365.

## Audit Procedure

### Using Azure Portal

1. From Azure Home select the Portal Menu.
2. Browse to `Microsoft Entra ID` > `Properties`.
3. Select `Manage security defaults`.
4. Under `Security defaults`, verify that `Enabled (recommended)` is selected.

### Using PowerShell

```powershell
Connect-MgGraph -Scopes "Policy.Read.All"
(Get-MgPolicyIdentitySecurityDefaultEnforcementPolicy).IsEnabled
```

Returned value should be `true`.

### Using Azure CLI

```bash
az login
az rest --method get --url 'https://graph.microsoft.com/v1.0/policies/identitySecurityDefaultsEnforcementPolicy' --query "isEnabled"
```

Returned value should be `true`.

## Expected Result

Security defaults should be enabled (IsEnabled = true). The Azure Portal should show `Enabled (recommended)` selected under Security defaults.

## Remediation

### Remediate from Azure Portal

1. From Azure Home select the Portal Menu.
2. Browse to `Microsoft Entra ID` > `Properties`.
3. Select `Manage security defaults`.
4. Under `Security defaults`, select `Enabled (recommended)`.
5. Select `Save`.

### Remediate from PowerShell

```powershell
Connect-MgGraph -Scopes "Policy.ReadWrite.ApplicationConfiguration"
Update-MgPolicyIdentitySecurityDefaultEnforcementPolicy -IsEnabled $true
(Get-MgPolicyIdentitySecurityDefaultEnforcementPolicy).IsEnabled
```

### Remediate from Azure CLI

```bash
az rest --method patch --url 'https://graph.microsoft.com/v1.0/policies/identitySecurityDefaultsEnforcementPolicy' --body '{"isEnabled":true}'
az rest --method get --url 'https://graph.microsoft.com/v1.0/policies/identitySecurityDefaultsEnforcementPolicy' --query "isEnabled"
```

## Default Value

If your tenant was created on or after October 22, 2019, security defaults may already be enabled in your tenant.

## References

1. https://learn.microsoft.com/en-us/entra/fundamentals/security-defaults
2. https://techcommunity.microsoft.com/t5/azure-active-directory-identity/introducing-security-defaults/ba-p/1061414
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-identity-management#im-2-protect-identity-and-authentication-systems

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
| ---------------- | ------- | ---- | ---- | ---- |
| v8 | 4.1 Establish and Maintain a Secure Configuration Process | x | x | x |
| v7 | 5.1 Establish Secure Configurations | x | x | x |

## Profile

Level 1 | Automated
