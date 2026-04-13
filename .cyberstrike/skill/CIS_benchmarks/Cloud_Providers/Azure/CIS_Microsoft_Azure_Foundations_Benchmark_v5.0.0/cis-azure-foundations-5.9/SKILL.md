---
name: cis-azure-foundations-5.9
description: "Ensure 'Number of days before users are asked to re-confirm their authentication information' is not set to '0'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, authentication, password-reset, registration]
cis_id: "5.9"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.5, cis-azure-foundations-5.10]
prerequisites: []
severity_boost: {}
---

# Ensure 'Number of days before users are asked to re-confirm their authentication information' is not set to '0'

## Description

Ensure that the number of days before users are asked to re-confirm their authentication information is not set to 0.

## Rationale

This setting is necessary if 'Require users to register when signing in' is enabled. If authentication re-confirmation is disabled, registered users will never be prompted to re-confirm their existing authentication information. If the authentication information for a user changes, such as a phone number or email, then the password reset information for that user reverts to the previously registered authentication information.

## Impact

Users will be prompted to re-confirm their authentication information after the number of days specified.

## Audit Procedure

### Using Azure Portal

1. From Azure Home select the Portal Menu.
2. Select `Microsoft Entra ID`.
3. Under `Manage`, select `Users`.
4. Select `Password reset`.
5. Under `Manage`, select `Registration`.
6. Ensure that `Number of days before users are asked to re-confirm their authentication information` is not set to `0`.

## Expected Result

`Number of days before users are asked to re-confirm their authentication information` should not be `0`. A value such as 180 days is recommended.

## Remediation

### Using Azure Portal

1. From Azure Home select the Portal Menu.
2. Select `Microsoft Entra ID`.
3. Under `Manage`, select `Users`.
4. Select `Password reset`.
5. Under `Manage`, select `Registration`.
6. Set the `Number of days before users are asked to re-confirm their authentication information` to your organization-defined frequency.
7. Click `Save`.

## Default Value

By default, the `Number of days before users are asked to re-confirm their authentication information` is set to "180 days".

## References

1. https://learn.microsoft.com/en-us/entra/identity/authentication/concept-sspr-howitworks#registration
2. https://support.microsoft.com/en-us/account-billing/reset-your-work-or-school-password-using-security-info-23dde81f-08bb-4776-ba72-e6b72b9dda9e
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-governance-strategy#gs-6-define-and-implement-identity-and-privileged-access-strategy
4. https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-methods

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.2 Establish an Access Revoking Process          | x    | x    | x    |
| v7               | 16.10 Ensure All Accounts Have An Expiration Date |      | x    | x    |

## Profile

Level 1 | Manual
