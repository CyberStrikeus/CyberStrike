---
name: cis-azure-foundations-5.11
description: "Ensure 'Notify all admins when other admins reset their password?' is set to 'Yes'"
category: cis-azure-foundations
version: "5.0.0"
author: cyberstrike-official
tags: [cis, azure, identity, password-reset, admin-notification, monitoring]
cis_id: "5.11"
cis_benchmark: "CIS Microsoft Azure Foundations Benchmark v5.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: [cis-azure-foundations-5.10, cis-azure-foundations-5.26]
prerequisites: []
severity_boost: {}
---

# Ensure 'Notify all admins when other admins reset their password?' is set to 'Yes'

## Description

Ensure that all Global Administrators are notified if any other administrator resets their password.

## Rationale

Administrator accounts are sensitive. Any password reset activity notification, when sent to all Administrators, ensures that all Global Administrators can passively confirm if such a reset is a common pattern within their group. For example, if all Administrators change their password every 30 days, any password reset activity before that may require administrator(s) to evaluate any unusual activity and confirm its origin.

## Impact

All Global Administrators will receive a notification from Azure every time a password is reset. This is useful for auditing procedures to confirm that there are no out of the ordinary password resets for Administrators. There is additional overhead, however, in the time required for Global Administrators to audit the notifications. This setting is only useful if all Global Administrators pay attention to the notifications and audit each one.

## Audit Procedure

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `Users`
4. Under `Manage`, select `Password reset`
5. Under `Manage`, select `Notifications`
6. Ensure that `Notify all admins when other admins reset their password?` is set to `Yes`

## Expected Result

`Notify all admins when other admins reset their password?` should be set to `Yes`.

## Remediation

### Using Azure Portal

1. From Azure Home select the Portal Menu
2. Select `Microsoft Entra ID`
3. Under `Manage`, select `Users`
4. Under `Manage`, select `Password reset`
5. Under `Manage`, select `Notifications`
6. Set `Notify all admins when other admins reset their password?` to `Yes`
7. Click `Save`

## Default Value

By default, `Notify all admins when other admins reset their password?` is set to "No".

## References

1. https://learn.microsoft.com/en-us/entra/identity/authentication/concept-sspr-howitworks#notifications
2. https://support.microsoft.com/en-us/account-billing/reset-your-work-or-school-password-using-security-info-23dde81f-08bb-4776-ba72-e6b72b9dda9e
3. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-governance-strategy#gs-6-define-and-implement-identity-and-privileged-access-strategy
4. https://learn.microsoft.com/en-us/security/benchmark/azure/mcsb-privileged-access#pa-1-separate-and-limit-highly-privilegedadministrative-users
5. https://learn.microsoft.com/en-us/entra/identity/authentication/tutorial-enable-sspr#set-up-notifications-and-customizations

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | x | x | x |
| v8 | 6.7 Centralize Access Control | | x | x |
| v7 | 4.8 Log and Alert on Changes to Administrative Group Membership | | x | x |

## Profile

Level 1 | Manual
