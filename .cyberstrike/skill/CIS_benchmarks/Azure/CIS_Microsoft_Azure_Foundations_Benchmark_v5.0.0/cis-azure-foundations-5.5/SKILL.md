---
name: cis-azure-foundations-5.5
description: "Ensure 'Number of methods required to reset' is set to '2'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, password-reset, sspr, mfa, authentication]
cis_id: "5.5"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.9, cis-azure-foundations-5.10, cis-azure-foundations-5.11]
prerequisites: []
severity_boost: {}
---

# Ensure 'Number of methods required to reset' is set to '2'

## Description

Ensures that two alternate forms of identification are provided before allowing a password reset.

## Rationale

A Self-service Password Reset (SSPR) through Azure Multi-factor Authentication (MFA) ensures the user's identity is confirmed using two separate methods of identification. With multiple methods set, an attacker would have to compromise both methods before they could maliciously reset a user's password.

## Impact

There may be administrative overhead, as users who lose access to their secondary authentication methods will need an administrator with permissions to remove it. There will also need to be organization-wide security policies and training to teach administrators to verify the identity of the requesting user so that social engineering cannot render this setting useless.

## Audit Procedure

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `Users`
4. Under `Manage`, select `Password reset`
5. Select `Authentication methods`
6. Ensure that `Number of methods required to reset` is set to `2`

## Expected Result

`Number of methods required to reset` should be set to `2`.

## Remediation

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `Users`
4. Under `Manage`, select `Password reset`
5. Select `Authentication methods`
6. Set the `Number of methods required to reset` to `2`
7. Click `Save`

## Default Value

By default, the `Number of methods required to reset` is `1`.

## References

1. https://learn.microsoft.com/en-us/entra/identity/authentication/tutorial-enable-sspr
2. https://learn.microsoft.com/en-us/entra/identity/authentication/concept-registration-mfa-sspr-combined
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-identity-management#im-6-use-strong-authentication-controls
4. https://learn.microsoft.com/en-us/entra/identity/authentication/passwords-faq#password-reset-registration
5. https://support.microsoft.com/en-us/account-billing/reset-your-work-or-school-password-using-security-info-23dde81f-08bb-4776-ba72-e6b72b9dda9e
6. https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-methods

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 6.3 Require MFA for Externally-Exposed Applications | | x | x |
| v8 | 6.4 Require MFA for Remote Network Access | x | x | x |
| v7 | 16.3 Require Multi-factor Authentication | | x | x |

## Profile

Level 1 | Manual
