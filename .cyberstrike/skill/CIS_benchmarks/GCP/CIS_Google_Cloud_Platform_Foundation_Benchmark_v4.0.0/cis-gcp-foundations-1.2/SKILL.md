---
name: cis-gcp-foundations-1.2
description: "Ensure That Multi-Factor Authentication is Enabled for All Non-Service Accounts"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, iam, service-accounts, mfa, kms, api-keys]
cis_id: "1.2"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.2 Ensure That Multi-Factor Authentication is Enabled for All Non-Service Accounts (Manual)

## Profile Applicability

- Level 1

## Description

Setup multi-factor authentication for Google Cloud Platform accounts.

## Rationale

Multi-factor authentication requires more than one mechanism to authenticate a user. This secures user logins from attackers exploiting stolen or weak credentials.

## Impact

None documented.

## Audit Procedure

**From Google Cloud Console**

For each Google Cloud Platform project, folder, or organization:

1. Identify non-service accounts.
2. Manually verify that multi-factor authentication for each account is set.

## Expected Result

All non-service accounts should have multi-factor authentication enabled.

## Remediation

**From Google Cloud Console**

For each Google Cloud Platform project:

1. Identify non-service accounts.
2. Setup multi-factor authentication for each account.

## Default Value

By default, multi-factor authentication is not set.

## References

1. https://cloud.google.com/solutions/securing-gcp-account-u2f
2. https://support.google.com/accounts/answer/185839

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 6.3 Require MFA for Externally-Exposed Applications - Require all externally-exposed enterprise or third-party applications to enforce MFA, where supported. Enforcing MFA through a directory service or SSO provider is a satisfactory implementation of this Safeguard. | | x | x |
| v7 | 16.3 Require Multi-factor Authentication - Require multi-factor authentication for all user accounts, on all systems, whether managed onsite or by a third-party provider. | | x | x |
