---
name: cis-gworkspace-4.1.4.1
description: "Ensure login challenges are enforced"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, security, login-challenges, authentication, sso]
cis_id: "4.1.4.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.4.1 Ensure login challenges are enforced

## Profile Applicability

- Enterprise Level 2

## Description

Configure Google Workspace to verify a user's identity post-sso.

## Rationale

Many organizations use third-party identity providers (IdPs) to authenticate users who use single sign on (SSO) through SAML. The third-party IdP authenticates users and no additional risk-based challenges are presented to them. Any Google 2-Step Verification (2SV) configuration is ignored. This is the default behavior. You can set a policy to allow additional risk-based authentication challenges and 2SV if it's configured. If Google receives a valid SAML assertion (authentication information about the user) from the IdP during user sign-in, Google can present additional challenges to the user.

Login challenges requires users have a recovery phone number or email account associated with their organizational account. If not previously configured, users will be prompted to enter this information periodically until provided.

One login challenge option prompts users to enter their employee ID. This method is susceptible to information gathering attacks, should a list of employee IDs ever be leaked.

## Impact

The potential impact associated with implementation of this setting is dependent upon the existing 2-Step Verification (2SV) polices.

- If you have existing 2SV policies, such as 2SV enforcement, those policies apply immediately.
- Users affected by the new policy and who are enrolled in 2SV get a 2SV challenge at sign-in.
- Based on Google sign-in risk analysis, users might see risk-based challenges at sign-in.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Security`
3. Select `Login Challenges`
4. Under `Post-SSO verification`, ensure `Logins using SSO are subject to additional verifications (if appropriate) and 2-Step Verification (if configured)` is `checked`
5. Under `Login challenges`, ensure `Use employee ID to keep my users more secure` is `unchecked`

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Security`
3. Select `Login Challenges`
4. Under `Post-SSO verification`, set `Logins using SSO are subject to additional verifications (if appropriate) and 2-Step Verification (if configured)` is `checked`
5. Select `Save`
6. Under `Login challenges`, set `Use employee ID to keep my users more secure` to `unchecked`
7. Select `Save`

## Default Value

- `Post-SSO verification` is `Logins using SSO bypass additional verifications`
- `Use employee ID to keep my users more secure` is `unchecked`

## CIS Controls

| Controls Version | Control                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.3 Require MFA for Externally-Exposed Applications |      | x    | x    |
| v7               | 16.3 Require Multi-factor Authentication            |      | x    | x    |
