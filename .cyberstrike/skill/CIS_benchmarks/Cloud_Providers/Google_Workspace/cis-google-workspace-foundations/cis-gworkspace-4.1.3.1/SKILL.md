---
name: cis-gworkspace-4.1.3.1
description: "Ensure Advanced Protection Program is configured"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, security, advanced-protection, security-keys, authentication]
cis_id: "4.1.3.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.3.1 Ensure Advanced Protection Program is configured

## Profile Applicability

- Enterprise Level 2

## Description

Enable Google's Advanced Protection Platform for all users and prevent the use of security codes where applicable.

## Rationale

Sophisticated phishing tactics can trick the most savvy users into giving their sign-in credentials to attackers. Advanced Protection requires you to use a security key, which is a hardware device or special software on your phone used to verify your identity, to sign in to your Google Account. Unauthorized users won't be able to sign in without your security key, even if they have your username and password.

The Advanced Protection Program includes a curated group of high-security policies that are applied to enrolled accounts. Additional policies may be added to the Advanced Protection Program to ensure the protections are current.

Advanced Protection allows you to apply all of these protections at once, and override similar settings you may have configured manually. These policies include:

- Strong authentication with security keys
- Use of security codes with security keys (as needed)
- Restrictions on third-party access to account data
- Deep Gmail scans
- Google Safe Browsing protections in Chrome (when users are signed into Chrome using the same identity as their Advanced Protection Program identity)
- Account recovery through admin

## Impact

### User Impact

- You need your security key when you sign in for the first time on a computer, browser, or device. If you stay signed in, you may not be asked to use your security key the next time you log in.
- Limits third-party app access to your data, puts stronger checks on suspicious downloads, and tightens account recovery security to help prevent unauthorized access.

### Security Keys - 2 Required

- Android: With an Android 7.0+ phone, you can enroll in a few taps by registering your phone's built-in security key.
- iPhone: If you have an iPhone running iOS 10.0+, install the `Google Smart Lock` app to register your security key first, then enroll.
- Two security keys are required for added assurance. If one key is lost or damaged, users can use the second key to regain account access.

### Third-Party iDP

- You can use the Advanced Protection Program with accounts that federate from an IdP using SAML. When users with these accounts enroll in the Advanced Protection Program, we'll require security key use after the user signs in on the IdP. Note that SAML users can select Remember the device to avoid challenges on a browser or device.

### Security Codes

- Before allowing users to generate security codes, carefully evaluate if your organization needs them. Using security keys with security codes increases the risk of phishing. However, if your organization has important workflows where security keys can't be used directly, enabling security codes for those situations may help improve your security posture overall.

### Using 'Sign in with Google' with other apps and services

- You can still sign into apps and services with Google. If they request access to your Gmail or Drive data, access is denied.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Security`
3. Select `Advanced Protection Program`
4. Under `Enrollment - Allow users to enroll in the Advanced Protection Program`, ensure `Enable user enrollment` is `selected` for the desired organizational unit or group
5. Under `Security Codes`, ensure `Do not allow users to generate security codes` is `selected` for the desired organizational unit or group

## Remediation

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Security`
3. Select `Advanced Protection Program`
4. Under `Enrollment - Allow users to enroll in the Advanced Protection Program`, set `Enable user enrollment` to `selected` for the desired organizational unit or group
5. Under `Security Codes`, set `Do not allow users to generate security codes` to `selected` for the desired organizational unit or group
6. Select `Save`

## Default Value

- `Allow users to enroll in the Advanced Protection Platform` is `selected`
- `Security codes` is `Allow security codes without remote access`

## CIS Controls

| Controls Version | Control                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.3 Require MFA for Externally-Exposed Applications |      | x    | x    |
| v7               | 16.3 Require Multi-factor Authentication            |      | x    | x    |
