---
name: cis-azure-foundations-5.7
description: "Ensure account 'Lockout duration in seconds' is greater than or equal to '60'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, account-lockout, brute-force, password-protection]
cis_id: "5.7"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.6, cis-azure-foundations-5.8]
prerequisites: []
severity_boost: {}
---

# Ensure account 'Lockout duration in seconds' is greater than or equal to '60'

## Description

The account lockout duration value determines how long an account retains the status of lockout, and therefore how long before a user can continue to attempt to login after passing the lockout threshold.

## Rationale

Account lockout is a method of protecting against brute-force and password spray attacks. Once the lockout threshold has been exceeded, the account enters a locked-out state which prevents all login attempts for a variable duration. The lockout in combination with a reasonable duration reduces the total number of failed login attempts that a malicious actor can execute in a given period of time.

## Impact

If account lockout duration is set too low (less than 60 seconds), malicious actors can perform more password spray and brute-force attempts over a given period of time. If the account lockout duration is set too high (more than 300 seconds) users may experience inconvenient delays during lockout.

## Audit Procedure

### Using Azure Portal

1. From Azure Home select the Portal Menu.
2. Select `Microsoft Entra ID`.
3. Under `Manage`, select `Security`.
4. Under `Manage`, select `Authentication methods`.
5. Under `Manage`, select `Password protection`.
6. Ensure that `Lockout duration in seconds` is set to `60` or higher.

## Expected Result

`Lockout duration in seconds` should be `60` or higher.

## Remediation

### Using Azure Portal

1. From Azure Home select the Portal Menu.
2. Select `Microsoft Entra ID`.
3. Under `Manage`, select `Security`.
4. Under `Manage`, select `Authentication methods`.
5. Under `Manage`, select `Password protection`.
6. Set the `Lockout duration in seconds` to `60` or higher.
7. Click `Save`.

## Default Value

By default, Lockout duration in seconds is set to `60`.

## References

1. https://learn.microsoft.com/en-us/entra/identity/authentication/howto-password-smart-lockout#manage-microsoft-entra-smart-lockout-values

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.10 Enforce Automatic Device Lockout on Portable End-User Devices | | x | x |

## Profile

Level 1 | Manual
