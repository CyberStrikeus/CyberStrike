---
name: cis-azure-foundations-5.28
description: "Ensure passwordless authentication methods are considered"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, passwordless, fido2, authentication, mfa]
cis_id: "5.28"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.22, cis-azure-foundations-5.5]
prerequisites: []
severity_boost: {}
---

# Ensure passwordless authentication methods are considered

## Description

Passwordless authentication methods improve security and user experience by replacing passwords with something you have (e.g., a hardware key), something you are (biometrics), or something you know, offering a convenient and secure way to access resources.

Microsoft Entra ID and Azure Government integrate the following passwordless authentication options:

- Windows Hello for Business
- Platform Credential for macOS
- Platform single sign-on (PSSO) for macOS with smart card authentication
- Microsoft Authenticator
- Passkeys (FIDO2)
- Certificate-based authentication

## Rationale

Using passwordless authentication makes sign-in easier and more secure by removing passwords, helping to protect organizations from attacks and improving the user experience.

## Impact

Implementing passwordless authentication requires administrative effort and may incur costs for some methods. It has the potential to save time and money by improving user convenience and productivity and by reducing the need for password support.

## Audit Procedure

### Using Azure Portal

1. Go to `Microsoft Entra ID`.
2. Click `Authentication methods`.
3. Under `Manage`, click `Policies`.
4. If appropriate for your organization, ensure a passwordless authentication method policy is configured.

## Expected Result

At least one passwordless authentication method policy should be configured and enabled for the organization.

## Remediation

1. Review the passwordless authentication method options: https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-passwordless.
2. Choose a passwordless authentication method: https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-passwordless#choose-a-passwordless-method.
3. Implement the chosen passwordless authentication method:
   - Microsoft Authenticator: https://learn.microsoft.com/en-us/entra/identity/authentication/how-to-enable-authenticator-passkey.
   - Passkeys (FIDO2): https://learn.microsoft.com/en-us/entra/identity/authentication/how-to-enable-passkey-fido2.

## Default Value

Passwordless authentication is not enabled by default.

## References

1. https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-methods
2. https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-passwordless

## CIS Controls

| Controls Version | Control                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------- | ---- | ---- | ---- |
| v8               | 6.5 Require MFA for Administrative Access | x    | x    | x    |
| v7               | 16.3 Require Multi-factor Authentication  |      | x    | x    |

## Profile

Level 2 | Manual
