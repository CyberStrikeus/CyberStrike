---
name: cis-gworkspace-4.1.1.3
description: "Ensure 2-Step Verification (MFA) is enforced for all users"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, security, mfa, 2fa, authentication]
cis_id: "4.1.1.3"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.1.3 Ensure 2-Step Verification (MFA) is enforced for all users

## Profile Applicability

- Enterprise Level 1

## Description

Enforce 2-Step Verification (Multi-Factor Authentication) for all users.

## Rationale

Add an extra layer of security to users accounts by asking users to verify their identity when they enter a username and password. 2-Step Verification (Multi-factor authentication) requires an individual to present a minimum of two separate forms of authentication before access is granted. 2-Step Verification provides additional assurance that the individual attempting to gain access is who they claim to be. With 2-Step Verification, an attacker would need to compromise at least two different authentication mechanisms, increasing the difficulty of compromise and thus reducing the risk.

## Impact

Implementation of 2-Step Verification (multi-factor authentication) for all users will necessitate a change to user routine. All users will be required to enroll in 2-Step Verification using phone, SMS, or an authentication application. After enrollment, use of 2-Step Verification will be required for future access to the environment.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Security`
3. Select `2-Step Verification`
4. Under `Authentication`, ensure `Allow users to turn on 2-Step Verification` is `checked`
5. Ensure `Enforcement` is set to `On`
6. Ensure `New user enrollment period` is set to `2 weeks`
7. Under `Frequency`, ensure `Allow user to trust device` is `not checked`
8. Under `Methods`, ensure `Any except verification codes via text, phone call` is `selected`

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Security`
3. Select `2-Step Verification`
4. Under `Authentication`, check `Allow users to turn on 2-Step Verification`
5. Set `Enforcement` to `On`
6. Set `New user enrollment period` to `2 weeks`
7. Under `Frequency`, uncheck `Allow user to trust device`
8. Under `Methods`, select `Any except verification codes via text, phone call`
9. Select `Save`

## Default Value

- `Allow users to turn on 2-Step Verification` is `checked`
- `Enforcement` is `Off`
- `New user enrollment period` is `None`
- `Frequency - Allow user to trust device` is `checked`
- `Methods` is `Any`

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 6.3 Require MFA for Externally-Exposed Applications | | x | x |
| v7 | 16.3 Require Multi-factor Authentication | | x | x |
