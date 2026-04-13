---
name: cis-azure-foundations-5.1.2
description: "Ensure 'multifactor authentication' is 'enabled' for all users"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, mfa]
cis_id: "5.1.2"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.1.1, cis-azure-foundations-5.1.3]
prerequisites: []
severity_boost: {}
---

# Ensure 'multifactor authentication' is 'enabled' for all users

## Description

[IMPORTANT - Please read the section overview: If your organization pays for Microsoft Entra ID licensing (included in Microsoft 365 E3, E5, F5, or Business Premium, and EM&S E3 or E5 licenses) and CAN use Conditional Access, ignore the recommendations in this section and proceed to the Conditional Access section.]

Enable multifactor authentication for all users.

Note: Since 2024, Azure has been rolling out mandatory multifactor authentication. For more information:

- https://azure.microsoft.com/en-us/blog/announcing-mandatory-multi-factor-authentication-for-azure-sign-in
- https://learn.microsoft.com/en-us/entra/identity/authentication/concept-mandatory-multifactor-authentication

## Rationale

Multifactor authentication requires an individual to present a minimum of two separate forms of authentication before access is granted. Multifactor authentication provides additional assurance that the individual attempting to gain access is who they claim to be. With multifactor authentication, an attacker would need to compromise at least two different authentication mechanisms, increasing the difficulty of compromise and thus reducing the risk.

## Impact

Users would require two forms of authentication before any access is granted. Additional administrative time will be required for managing dual forms of authentication when enabling multifactor authentication.

## Audit Procedure

### Using Azure Portal

1. Go to `Microsoft Entra ID`.
2. Under `Manage`, click `Users`.
3. Click `Per-user MFA` from the top menu.
4. Ensure that `Status` is `enabled` for all users.

### Using PowerShell

```powershell
get-mguser -All | where {$_.StrongAuthenticationMethods.Count -eq 0} | Select-Object -Property UserPrincipalName
```

If the output contains any `UserPrincipalName`, then this recommendation is non-compliant.

## Expected Result

All users should have MFA enabled. The PowerShell command should return no results (no users without strong authentication methods).

## Remediation

### Remediate from Azure Portal

1. Go to `Microsoft Entra ID`.
2. Under `Manage`, click `Users`.
3. Click `Per-user MFA` from the top menu.
4. Click the box next to a user with `Status disabled`.
5. Click `Enable MFA`.
6. Click `Enable`.
7. Repeat steps 1-6 for each user requiring remediation.

## Default Value

Multifactor authentication is not enabled for all users by default. Starting in 2024, multifactor authentication is enabled for administrative accounts by default.

## References

1. https://learn.microsoft.com/en-us/entra/identity/authentication/concept-mfa-howitworks
2. https://learn.microsoft.com/en-us/entra/identity/authentication/concept-mandatory-multifactor-authentication
3. https://azure.microsoft.com/en-us/blog/announcing-mandatory-multi-factor-authentication-for-azure-sign-in/
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-identity-management#im-4-authenticate-server-and-services

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
| ---------------- | ------- | ---- | ---- | ---- |
| v8 | 6.3 Require MFA for Externally-Exposed Applications | | x | x |
| v8 | 6.4 Require MFA for Remote Network Access | x | x | x |
| v7 | 16.3 Require Multi-factor Authentication | | x | x |

## Profile

Level 1 | Automated
