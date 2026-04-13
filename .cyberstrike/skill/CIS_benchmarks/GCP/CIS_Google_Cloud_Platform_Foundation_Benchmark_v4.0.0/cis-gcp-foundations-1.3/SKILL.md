---
name: cis-gcp-foundations-1.3
description: "Ensure That Security Key Enforcement is Enabled for All Admin Accounts"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, iam, service-accounts, mfa, kms, api-keys]
cis_id: "1.3"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.3 Ensure That Security Key Enforcement is Enabled for All Admin Accounts (Manual)

## Profile Applicability

- Level 2

## Description

Setup Security Key Enforcement for Google Cloud Platform admin accounts.

## Rationale

Google Cloud Platform users with Organization Administrator roles have the highest level of privilege in the organization. These accounts should be protected with the strongest form of two-factor authentication: Security Key Enforcement. Ensure that admins use Security Keys to log in instead of weaker second factors like SMS or one-time passwords (OTP). Security Keys are actual physical keys used to access Google Organization Administrator Accounts. They send an encrypted signature rather than a code, ensuring that logins cannot be phished.

## Impact

If an organization administrator loses access to their security key, the user could lose access to their account. For this reason, it is important to set up backup security keys.

## Audit Procedure

1. Identify users with Organization Administrator privileges:

```bash
gcloud organizations get-iam-policy ORGANIZATION_ID
```

Look for members granted the role `roles/resourcemanager.organizationAdmin`.

2. Manually verify that Security Key Enforcement has been enabled for each account.

## Expected Result

All users with Organization Administrator privileges should have Security Key Enforcement enabled.

## Remediation

1. Identify users with the Organization Administrator role.
2. Setup Security Key Enforcement for each account. Learn more at: https://cloud.google.com/security-key/

## Default Value

By default, Security Key Enforcement is not enabled for Organization Administrators.

## References

1. https://cloud.google.com/security-key/
2. https://gsuite.google.com/learn-more/key_for_working_smarter_faster_and_more_securely.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 6.3 Require MFA for Externally-Exposed Applications - Require all externally-exposed enterprise or third-party applications to enforce MFA, where supported. Enforcing MFA through a directory service or SSO provider is a satisfactory implementation of this Safeguard. | | x | x |
| v7 | 16.3 Require Multi-factor Authentication - Require multi-factor authentication for all user accounts, on all systems, whether managed onsite or by a third-party provider. | | x | x |
