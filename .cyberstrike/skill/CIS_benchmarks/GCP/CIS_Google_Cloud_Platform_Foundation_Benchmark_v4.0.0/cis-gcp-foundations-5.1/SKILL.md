---
name: cis-gcp-foundations-5.1
description: "Ensure That Cloud Storage Bucket Is Not Anonymously or Publicly Accessible"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, storage, cloud-storage]
cis_id: "5.1"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1 Ensure That Cloud Storage Bucket Is Not Anonymously or Publicly Accessible (Automated)

## Profile Applicability

- Level 1

## Description

It is recommended that IAM policy on Cloud Storage bucket does not allows anonymous or public access.

## Rationale

Allowing anonymous or public access grants permissions to anyone to access bucket content. Such access might not be desired if you are storing any sensitive data. Hence, ensure that anonymous or public access to a bucket is not allowed.

## Impact

No storage buckets would be publicly accessible. You would have to explicitly administer bucket access.

## Audit

### From Google Cloud Console

1. Go to `Storage browser` by visiting https://console.cloud.google.com/storage/browser.
2. Click on each bucket name to go to its `Bucket details` page.
3. Click on the `Permissions` tab.
4. Ensure that `allUsers` and `allAuthenticatedUsers` are not in the `Members` list.

### From Google Cloud CLI

1. List all buckets in a project

```
gsutil ls
```

2. Check the IAM Policy for each bucket:

```
gsutil iam get gs://BUCKET_NAME
```

No role should contain `allUsers` and/or `allAuthenticatedUsers` as a member.

### Using Rest API

1. List all buckets in a project

```
Get https://www.googleapis.com/storage/v1/b?project=<ProjectName>
```

2. Check the IAM Policy for each bucket

```
GET https://www.googleapis.com/storage/v1/b/<bucketName>/iam
```

No role should contain `allUsers` and/or `allAuthenticatedUsers` as a member.

## Remediation

### From Google Cloud Console

1. Go to `Storage browser` by visiting https://console.cloud.google.com/storage/browser.
2. Click on the bucket name to go to its `Bucket details` page.
3. Click on the `Permissions` tab.
4. Click `Delete` button in front of `allUsers` and `allAuthenticatedUsers` to remove that particular role assignment.

### From Google Cloud CLI

Remove `allUsers` and `allAuthenticatedUsers` access.

```
gsutil iam ch -d allUsers gs://BUCKET_NAME
gsutil iam ch -d allAuthenticatedUsers gs://BUCKET_NAME
```

## Prevention

You can prevent Storage buckets from becoming publicly accessible by setting up the `Domain restricted sharing` organization policy at:
https://console.cloud.google.com/iam-admin/orgpolicies/iam-allowedPolicyMemberDomains

## Default Value

By Default, Storage buckets are not publicly shared.

## References

1. https://cloud.google.com/storage/docs/access-control/iam-reference
2. https://cloud.google.com/storage/docs/access-control/making-data-public
3. https://cloud.google.com/storage/docs/gsutil/commands/iam

## Additional Information

To implement Access restrictions on buckets, configuring Bucket IAM is preferred way than configuring Bucket ACL. On GCP console, "Edit Permissions" for bucket exposes IAM configurations only. Bucket ACLs are configured automatically as per need in order to implement/support User enforced Bucket IAM policy. In-case administrator changes bucket ACL using command-line(gsutils)/API bucket IAM also gets updated automatically.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | | x | x |
| v7 | 12.4 Deny Communication over Unauthorized Ports | | x | x |
