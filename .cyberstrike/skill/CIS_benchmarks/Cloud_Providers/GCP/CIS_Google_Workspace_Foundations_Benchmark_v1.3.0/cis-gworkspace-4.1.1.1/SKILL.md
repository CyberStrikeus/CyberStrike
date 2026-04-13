---
name: cis-gworkspace-4.1.1.1
description: "Ensure 2-Step Verification (MFA) is enforced for all users in administrative roles"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, security, mfa, 2fa, authentication]
cis_id: "4.1.1.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.1.1 Ensure 2-Step Verification (MFA) is enforced for all users in administrative roles

## Profile Applicability

- Enterprise Level 1

## Description

Enforce 2-Step Verification (Multi-Factor Authentication) for all users assigned administrative roles. These include roles such as:

- Help Desk Admin
- Groups Admin
- Super Admin
- Services Admin
- User Management Admin
- Mobile Admin
- Android Admin
- Custom Admin Roles

## Rationale

Add an extra layer of security to users accounts by asking users to verify their identity when they enter a username and password. 2-Step Verification (Multi-factor authentication) requires an individual to present a minimum of two separate forms of authentication before access is granted. 2-Step Verification provides additional assurance that the individual attempting to gain access is who they claim to be. With 2-Step Verification, an attacker would need to compromise at least two different authentication mechanisms, increasing the difficulty of compromise and thus reducing the risk.

## Impact

Implementation of 2-Step Verification (multi-factor authentication) for all users in administrative roles will necessitate a change to user routine. All users in administrative roles will be required to enroll in 2-Step Verification using phone, SMS, or an authentication application. After enrollment, use of 2-Step Verification will be required for future access to the environment.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Go to `Security` and click on `2-Step Verification`
3. Select the appropriate group with `ALL ADMIN ROLES` -- Create this group if needed
4. Under `Authentication`, ensure `Allow users to turn on 2-Step Verification` is `checked`
5. Ensure `Enforcement` is set to `On`
6. Ensure `New user enrollment period` is set to `2 weeks`
7. Under `Frequency`, ensure `Allow user to trust device` is `unchecked`
8. Under `Methods`, ensure `Any except verification codes via text, phone call` is `selected`

## Remediation

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Go to `Security` and click on `2-Step Verification`
3. Select the appropriate group with `ALL ADMIN ROLES` -- Create this group if needed
4. Under `Authentication`, set `Allow users to turn on 2-Step Verification` to `checked`
5. Set `Enforcement` to `On`
6. Set `New user enrollment period` is set to `2 weeks`
7. Under `Frequency`, set `Allow user to trust device` to `unchecked`
8. Under `Methods`, set `Any except verification codes via text, phone call` to `selected`
9. Select `Save`

## Default Value

- `Allow users to turn on 2-Step Verification` is `checked`
- `Enforcement` is `Off`
- `New user enrollment period` is `None`
- `Frequency - Allow user to trust device` is `checked`
- `Methods` is `Any`

## CIS Controls

| Controls Version | Control                                                          | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.5 Require MFA for Administrative Access                        | x    | x    | x    |
| v7               | 4.5 Use Multifactor Authentication For All Administrative Access |      | x    | x    |
