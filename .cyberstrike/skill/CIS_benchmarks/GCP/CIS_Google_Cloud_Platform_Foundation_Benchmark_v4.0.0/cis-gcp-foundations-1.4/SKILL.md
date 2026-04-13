---
name: cis-gcp-foundations-1.4
description: "Ensure That There Are Only GCP-Managed Service Account Keys for Each Service Account"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, iam, service-accounts, mfa, kms, api-keys]
cis_id: "1.4"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.4 Ensure That There Are Only GCP-Managed Service Account Keys for Each Service Account (Automated)

## Profile Applicability

- Level 1

## Description

User-managed service accounts should not have user-managed keys.

## Rationale

Anyone who has access to the keys will be able to access resources through the service account. GCP-managed keys are used by Cloud Platform services such as App Engine and Compute Engine. These keys cannot be downloaded. Google will keep the keys and automatically rotate them on an approximately weekly basis. User-managed keys are created, downloadable, and managed by users. They expire 10 years from creation.

For user-managed keys, the user has to take ownership of key management activities which include:

- Key storage
- Key distribution
- Key revocation
- Key rotation
- Protecting the keys from unauthorized users
- Key recovery

Even with key owner precautions, keys can be easily leaked by common development malpractices like checking keys into the source code or leaving them in the Downloads directory, or accidentally leaving them on support blogs/channels.

It is recommended to prevent user-managed service account keys.

## Impact

Deleting user-managed service account keys may break communication with the applications using the corresponding keys.

## Audit Procedure

**From Google Cloud Console**

1. Go to the IAM page in the GCP Console using `https://console.cloud.google.com/iam-admin/iam`
2. In the left navigation pane, click `Service accounts`. All service accounts and their corresponding keys are listed.
3. Click the service accounts and check if keys exist.

**From Google Cloud CLI**

1. List all the service accounts:

```bash
gcloud iam service-accounts list
```

2. Identify user-managed service accounts which have an account `EMAIL` ending with `iam.gserviceaccount.com`. For each user-managed service account, list the keys managed by the user:

```bash
gcloud iam service-accounts keys list --iam-account=<Service Account> --managed-by=user
```

## Expected Result

No keys should be listed.

## Remediation

**From Google Cloud Console**

1. Go to the IAM page in the GCP Console using `https://console.cloud.google.com/iam-admin/iam`
2. In the left navigation pane, click `Service accounts`. All service accounts and their corresponding keys are listed.
3. Click the service account.
4. Click the `edit` and delete the keys.

**From Google Cloud CLI**

To delete a user managed Service Account Key:

```bash
gcloud iam service-accounts keys delete --iam-account=<user-managed-service-account-EMAIL> <KEY-ID>
```

**Prevention:**

You can disable service account key creation through the `Disable service account key creation` Organization policy by visiting `https://console.cloud.google.com/iam-admin/orgpolicies/iam-disableServiceAccountKeyCreation`. Learn more at: https://cloud.google.com/resource-manager/docs/organization-policy/restricting-service-accounts

In addition, if you do not need to have service accounts in your project, you can also prevent the creation of service accounts through the `Disable service account creation` Organization policy: `https://console.cloud.google.com/iam-admin/orgpolicies/iam-disableServiceAccountCreation`.

## Default Value

By default, there are no user-managed keys created for user-managed service accounts.

## Additional Information

A user-managed key cannot be created on GCP-Managed Service Accounts.

## References

1. https://cloud.google.com/iam/docs/understanding-service-accounts#managing_service_account_keys
2. https://cloud.google.com/resource-manager/docs/organization-policy/restricting-service-accounts

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 0.0 Explicitly Not Mapped | | | |
| v7 | 0.0 Explicitly Not Mapped | | | |
