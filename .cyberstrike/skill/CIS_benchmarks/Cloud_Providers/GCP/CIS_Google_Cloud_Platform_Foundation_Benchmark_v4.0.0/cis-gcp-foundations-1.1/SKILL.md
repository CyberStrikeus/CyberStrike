---
name: cis-gcp-foundations-1.1
description: "Ensure That Corporate Login Credentials Are Used"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, iam, service-accounts, mfa, kms, api-keys]
cis_id: "1.1"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.1 Ensure That Corporate Login Credentials Are Used (Manual)

## Profile Applicability

- Level 1

## Description

Use corporate login credentials instead of consumer accounts, such as Gmail accounts.

## Rationale

It is recommended fully-managed corporate Google accounts be used for increased visibility, auditing, and controlling access to Cloud Platform resources. Email accounts based outside of the user's organization, such as consumer accounts, should not be used for business purposes.

## Impact

There will be increased overhead as maintaining accounts will now be required. For smaller organizations, this will not be an issue, but will balloon with size.

## Audit Procedure

For each Google Cloud Platform project, list the accounts that have been granted access to that project.

**From Google Cloud CLI**

1. List the accounts added on each project:

```bash
gcloud projects get-iam-policy PROJECT_ID
```

2. Also list the accounts added on each folder:

```bash
gcloud resource-manager folders get-iam-policy FOLDER_ID
```

3. And list your organization's IAM policy:

```bash
gcloud organizations get-iam-policy ORGANIZATION_ID
```

## Expected Result

No email accounts outside the organization domain should be granted permissions in the IAM policies. This excludes Google-owned service accounts.

## Remediation

Remove all consumer Google accounts from IAM policies. Follow the documentation and setup corporate login accounts.

**Prevention:**

To ensure that no email addresses outside the organization can be granted IAM permissions to its Google Cloud projects, folders or organization, turn on the Organization Policy for `Domain Restricted Sharing`. Learn more at:
https://cloud.google.com/resource-manager/docs/organization-policy/restricting-domains

**From Google Cloud Console**

Follow the documentation to set up corporate login accounts and remove consumer accounts from IAM policies.

## Default Value

By default, no email addresses outside the organization's domain have access to its Google Cloud deployments, but any user email account can be added to the IAM policy for Google Cloud Platform projects, folders, or organizations.

## References

1. https://support.google.com/work/android/answer/6371476
2. https://cloud.google.com/sdk/gcloud/reference/projects/get-iam-policy
3. https://cloud.google.com/sdk/gcloud/reference/resource-manager/folders/get-iam-policy
4. https://cloud.google.com/sdk/gcloud/reference/organizations/get-iam-policy
5. https://cloud.google.com/resource-manager/docs/organization-policy/restricting-domains
6. https://cloud.google.com/resource-manager/docs/organization-policy/org-policy-constraints

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.6 Centralize Account Management - Centralize account management through a directory or identity service.                                                                                              |      | x    | x    |
| v7               | 16.2 Configure Centralized Point of Authentication - Configure access for all accounts through as few centralized points of authentication as possible, including network, security, and cloud systems. |      | x    | x    |
