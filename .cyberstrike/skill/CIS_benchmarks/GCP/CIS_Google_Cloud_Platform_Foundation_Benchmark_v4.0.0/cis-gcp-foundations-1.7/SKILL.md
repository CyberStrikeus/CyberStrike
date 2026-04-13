---
name: cis-gcp-foundations-1.7
description: "Ensure User-Managed/External Keys for Service Accounts Are Rotated Every 90 Days or Fewer"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, iam, service-accounts, mfa, kms, api-keys]
cis_id: "1.7"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.7 Ensure User-Managed/External Keys for Service Accounts Are Rotated Every 90 Days or Fewer (Automated)

## Profile Applicability

- Level 1

## Description

Service Account keys consist of a key ID (Private_key_Id) and Private key, which are used to sign programmatic requests users make to Google cloud services accessible to that particular service account. It is recommended that all Service Account keys are regularly rotated.

## Rationale

Rotating Service Account keys will reduce the window of opportunity for an access key that is associated with a compromised or terminated account to be used. Service Account keys should be rotated to ensure that data cannot be accessed with an old key that might have been lost, cracked, or stolen.

Each service account is associated with a key pair managed by Google Cloud Platform (GCP). It is used for service-to-service authentication within GCP. Google rotates the keys daily.

GCP provides the option to create one or more user-managed (also called external key pairs) key pairs for use from outside GCP (for example, for use with Application Default Credentials). When a new key pair is created, the user is required to download the private key (which is not retained by Google). With external keys, users are responsible for keeping the private key secure and other management operations such as key rotation. External keys can be managed by the IAM API, gcloud command-line tool, or the Service Accounts page in the Google Cloud Platform Console. GCP facilitates up to 10 external service account keys per service account to facilitate key rotation.

## Impact

Rotating service account keys will break communication for dependent applications. Dependent applications need to be configured manually with the new key `ID` displayed in the `Service account keys` section and the `private key` downloaded by the user.

## Audit Procedure

**From Google Cloud Console**

1. Go to `APIs & Services\Credentials` using `https://console.cloud.google.com/apis/credentials`
2. In the section `Service Account Keys`, for every External (user-managed) service account key listed ensure the `creation date` is within the past 90 days.

**From Google Cloud CLI**

1. List all Service accounts from a project.

```bash
gcloud iam service-accounts list
```

2. For every service account list service account keys.

```bash
gcloud iam service-accounts keys list --iam-account [Service_Account_Email_Id] --format=json
```

3. Ensure every service account key for a service account has a `"validAfterTime"` value within the past 90 days.

## Expected Result

All user-managed/external service account keys should have a `validAfterTime` within the past 90 days.

## Remediation

**From Google Cloud Console**

Delete any external (user-managed) Service Account Key older than 90 days:

1. Go to `APIs & Services\Credentials` using `https://console.cloud.google.com/apis/credentials`
2. In the Section `Service Account Keys`, for every external (user-managed) service account key where `creation date` is greater than or equal to the past 90 days, click `Delete Bin Icon` to `Delete Service Account key`

Create a new external (user-managed) Service Account Key for a Service Account:

1. Go to `APIs & Services\Credentials` using `https://console.cloud.google.com/apis/credentials`
2. Click `Create Credentials` and Select `Service Account Key`.
3. Choose the service account in the drop-down list for which an External (user-managed) Service Account key needs to be created.
4. Select the desired key type format among `JSON` or `P12`.
5. Click `Create`. It will download the `private key`. Keep it safe.
6. Click `Close` if prompted.
7. The site will redirect to the `APIs & Services\Credentials` page. Make a note of the new `ID` displayed in the `Service account keys` section.

## Default Value

GCP does not provide an automation option for External (user-managed) Service key rotation.

## Additional Information

For user-managed Service Account key(s), key management is entirely the user's responsibility.

## References

1. https://cloud.google.com/iam/docs/understanding-service-accounts#managing_service_account_keys
2. https://cloud.google.com/sdk/gcloud/reference/iam/service-accounts/keys/list
3. https://cloud.google.com/iam/docs/service-accounts

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 0.0 Explicitly Not Mapped | | | |
| v7 | 0.0 Explicitly Not Mapped | | | |
