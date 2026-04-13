---
name: cis-gcp-foundations-7.1
description: "Ensure That BigQuery Datasets Are Not Anonymously or Publicly Accessible"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, bigquery, encryption, cmek]
cis_id: "7.1"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.1 Ensure That BigQuery Datasets Are Not Anonymously or Publicly Accessible (Automated)

## Profile Applicability

- Level 1

## Description

It is recommended that the IAM policy on BigQuery datasets does not allow anonymous and/or public access.

## Rationale

Granting permissions to `allUsers` or `allAuthenticatedUsers` allows anyone to access the dataset. Such access might not be desirable if sensitive data is being stored in the dataset. Therefore, ensure that anonymous and/or public access to a dataset is not allowed.

## Impact

The dataset is not publicly accessible. Explicit modification of IAM privileges would be necessary to make them publicly accessible.

## Audit

### From Google Cloud Console

1. Go to `BigQuery` by visiting: https://console.cloud.google.com/bigquery.
2. Select a dataset from `Resources`.
3. Click `SHARING` near the right side of the window and select `Permissions`.
4. Validate that none of the attached roles contain `allUsers` or `allAuthenticatedUsers`.

### From Google Cloud CLI

List the name of all datasets.

```bash
bq ls
```

Retrieve each dataset details using the following command:

```bash
bq show PROJECT_ID:DATASET_NAME
```

Ensure that `allUsers` and `allAuthenticatedUsers` have not been granted access to the dataset.

## Remediation

### From Google Cloud Console

1. Go to `BigQuery` by visiting: https://console.cloud.google.com/bigquery.
2. Select the dataset from 'Resources'.
3. Click `SHARING` near the right side of the window and select `Permissions`.
4. Review each attached role.
5. Click the delete icon for each member `allUsers` or `allAuthenticatedUsers`. On the popup click `Remove`.

### From Google Cloud CLI

List the name of all datasets.

```bash
bq ls
```

Retrieve the data set details:

```bash
bq show --format=prettyjson PROJECT_ID:DATASET_NAME > PATH_TO_FILE
```

In the access section of the JSON file, update the dataset information to remove all roles containing `allUsers` or `allAuthenticatedUsers`.

Update the dataset:

```bash
bq update --source PATH_TO_FILE PROJECT_ID:DATASET_NAME
```

## Prevention

You can prevent Bigquery dataset from becoming publicly accessible by setting up the `Domain restricted sharing` organization policy at: https://console.cloud.google.com/iam-admin/orgpolicies/iam-allowedPolicyMemberDomains.

## Default Value

By default, BigQuery datasets are not publicly accessible.

## References

1. https://cloud.google.com/bigquery/docs/dataset-access-controls

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | X | X | X |
| v7 | 14.6 Protect Information through Access Control Lists | X | X | X |
