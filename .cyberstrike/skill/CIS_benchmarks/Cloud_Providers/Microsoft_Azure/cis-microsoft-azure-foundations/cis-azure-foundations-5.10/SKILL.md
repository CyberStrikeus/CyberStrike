---
name: cis-azure-foundations-5.10
description: "Ensure 'Notify users on password resets?' is set to 'Yes'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, password-reset, notifications, monitoring]
cis_id: "5.10"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.11, cis-azure-foundations-5.5]
prerequisites: []
severity_boost: {}
---

# Ensure 'Notify users on password resets?' is set to 'Yes'

## Description

Ensure that users are notified on their primary and alternate emails on password resets.

## Rationale

User notification on password reset is a proactive way of confirming password reset activity. It helps the user to recognize unauthorized password reset activities.

## Impact

Users will receive emails alerting them to password changes to both their primary and alternate emails.

## Audit Procedure

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `Users`
4. Under `Manage`, select `Password reset`
5. Under `Manage`, select `Notifications`
6. Ensure that `Notify users on password resets?` is set to `Yes`

## Expected Result

`Notify users on password resets?` should be set to `Yes`.

## Remediation

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `Users`
4. Under `Manage`, select `Password reset`
5. Under `Manage`, select `Notifications`
6. Set `Notify users on password resets?` to `Yes`
7. Click `Save`

## Default Value

By default, `Notify users on password resets?` is set to "Yes".

## References

1. https://learn.microsoft.com/en-us/entra/identity/authentication/tutorial-enable-sspr#set-up-notifications-and-customizations
2. https://learn.microsoft.com/en-us/entra/identity/authentication/concept-sspr-howitworks#notifications
3. https://support.microsoft.com/en-us/account-billing/reset-your-work-or-school-password-using-security-info-23dde81f-08bb-4776-ba72-e6b72b9dda9e
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-governance-strategy#gs-6-define-and-implement-identity-and-privileged-access-strategy

## CIS Controls

| Controls Version | Control                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.7 Centralize Access Control                      |      | x    | x    |
| v7               | 16.2 Configure Centralized Point of Authentication |      | x    | x    |

## Profile

Level 1 | Manual
