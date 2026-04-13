---
name: cis-gworkspace-4.1.1.2
description: "Ensure hardware security keys are used for all users in administrative roles and other high-value accounts"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, security, mfa, 2fa, security-keys, authentication]
cis_id: "4.1.1.2"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.1.2 Ensure hardware security keys are used for all users in administrative roles and other high-value accounts

## Profile Applicability

- Enterprise Level 2

## Description

A hardware security key connects to a user's device using USB (A & C), Lightning, NFC, or Bluetooth connection. Also, many Android phones and Apple iPhones have built-in security keys accessible via Bluetooth and that can be assigned to a Google Workspace account.

The purpose of a physical security key is to provide an additional security layer to high value accounts; in the event of a compromise of a user's credentials (username and password) without the associated security key, the authentication process cannot be successfully completed.

## Rationale

The purpose of a physical security key is to provide an additional security layer to high value accounts; in the event of a compromise of a user's credentials (username and password) without the associated security key, the authentication process cannot be successfully completed.

Hardware security keys help to protect high value accounts from targeted attacks, including phishing attempts.

Adding a hardware security key requirement to your Google privileged accounts adds another layer of depth of protection greater than any other form of two-factor authentication.

## Impact

Users with hardware security keys enabled will need to have physical access to the hardware key in order complete the authentication process and this will force users to adopt a practice of making sure that the physical key is available to them at any point in time that they need to be able to log in.

If a hardware security key is lost or stolen, the impacted user can gain access to their Google account by using a backup MFA process and then remove the lost/stolen key and add another one.

If a hardware security key is stolen, the user's account is not automatically compromised as the hardware key works in conjunction with the user's account credentials (username & password).

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Go to `Security` and click on `Authentication`
3. Under `Authentication`, select `2-Step Verification`
4. Ensure the option to `Allow users to turn on 2-Step Verification` is checked
5. Ensure that the `Enforcement` option is set to either `'On'` or `'On from'` with a valid date present
6. Under `Methods` ensure that `Only security key` is selected
7. Under `2-Step Verification policy suspension grace period` ensure that `1 day` is selected
8. Under `Security codes` ensure that `Don't allow users to generate security codes` is selected

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Go to `Security` and click on `Authentication`
3. Under `Authentication`, select `2-Step Verification`
4. Select the option to `Allow users to turn on 2-Step Verification`
5. Under `Enforcement`, enable either `'On'` or else `'On from'` and configure a valid date
6. Under `Methods`, select `Only security key` to force the use of a security key
7. Under `2-Step Verification policy suspension grace period`, select `1 day`
8. Under `Security codes`, select `Don't allow users to generate security codes`
9. Select `Save`

## Default Value

- `Allow users to turn on 2-Step Verification` is `checked`
- `Enforcement` is `Off`
- `New user enrollment period` is `None`
- `Frequency - Allow user to trust device` is `checked`
- `Methods` is `Any`

## References

1. https://support.google.com/accounts/answer/6103523?hl=En

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 6.5 Require MFA for Administrative Access | x | x | x |
| v7 | 4.5 Use Multifactor Authentication For All Administrative Access | | x | x |
