---
name: cis-gworkspace-4.1.5.1
description: "Ensure password policy is configured for enhanced security"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, security, password-policy, authentication]
cis_id: "4.1.5.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.5.1 Ensure password policy is configured for enhanced security

## Profile Applicability

- Enterprise Level 1

## Description

Configure Google Workspace Password Policy with a more secure length and is enforced upon next sign-in to protect against the use of common password attacks.

## Rationale

Strong password policies protect an organization by prohibiting the use of weak passwords.

## Impact

The potential impact associated with implementation of this setting is dependent upon the existing password policies in place in the environment. For environments that have strong password policies in place, the impact will be minimal. For organizations that do not have strong password policies in place, enhancing the password policy may require users to change passwords, and adhere to more stringent requirements than they have been accustomed to.

Configuring passwords to expire at a 1 year mark ensures that users are not forced to change passwords so often that easily discerned patterns are used in the creation of the passwords. The day-to-day impact on users will be that they have to manage fewer passwords changing on a frequent basis.

**NOTE:** Password should be changed immediately on any indication of system compromise, when a user role changes, and when a user leaves the organization.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Security`
3. Select `Password management`
4. Under `Strength`, ensure `Enforce strong passwords` is `checked`
5. Under `Length`, ensure `Minimum Length` is set to `14+`
6. Under `Strength and Length enforcement`, ensure `Enforce password policy at next sign-in` is set to `checked`
7. Under `Reuse`, ensure `Allow password reuse` is `unchecked`
8. Under `Expiration`, ensure `Password reset frequency` is set to `365 Days`

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Security`
3. Select `Password management`
4. Under `Strength`, set `Enforce strong passwords` to `checked`
5. Under `Length`, set `Minimum Length` to `14` or greater
6. Under `Strength and Length enforcement`, set `Enforce password policy at next sign-in` is `checked`
7. Under `Reuse`, set `Allow password reuse` to `unchecked`
8. Under `Expiration`, set `Password reset frequency` to `365 Days`
9. Select `Save`

## Default Value

- `Enforce strong password` is `checked`
- `Minimum length` is `8`
- `Maximum length` is `100`
- `Enforce password policy at next sign-in` is `not checked`
- `Allow password reuse` is `not checked`
- `Expiration` is `Never expires`

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 5.2 Use Unique Passwords | x | x | x |
| v7 | 4.4 Use Unique Passwords | | x | x |
