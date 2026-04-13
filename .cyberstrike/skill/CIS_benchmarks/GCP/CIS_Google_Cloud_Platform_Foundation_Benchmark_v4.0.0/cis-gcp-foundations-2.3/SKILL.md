---
name: cis-gcp-foundations-2.3
description: "Ensure That Retention Policies on Cloud Storage Buckets Used for Exporting Logs Are Configured Using Bucket Lock"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, logging, monitoring, bucket-lock, log-sinks, cloud-storage]
cis_id: "2.3"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure That Retention Policies on Cloud Storage Buckets Used for Exporting Logs Are Configured Using Bucket Lock (Automated)

## Description

Enabling retention policies on log buckets will protect logs stored in cloud storage buckets from being overwritten or accidentally deleted. It is recommended to set up retention policies and configure Bucket Lock on all storage buckets that are used as log sinks.

## Rationale

Logs can be exported by creating one or more sinks that include a log filter and a destination. As Cloud Logging receives new log entries, they are compared against each sink. If a log entry matches a sink's filter, then a copy of the log entry is written to the destination.

Sinks can be configured to export logs in storage buckets. It is recommended to configure a data retention policy for these cloud storage buckets and to lock the data retention policy; thus permanently preventing the policy from being reduced or removed. This way, if the system is ever compromised by an attacker or a malicious insider who wants to cover their tracks, the activity logs are definitely preserved for forensics and security investigations.

## Impact

Locking a bucket is an irreversible action. Once you lock a bucket, you cannot remove the retention policy from the bucket or decrease the retention period for the policy. You will then have to wait for the retention period for all items within the bucket before you can delete them, and then the bucket.

## Audit Procedure

### Using Google Cloud Console

1. Open the Cloud Storage browser in the Google Cloud Console by visiting https://console.cloud.google.com/storage/browser.
2. In the Column display options menu, make sure `Retention policy` is checked.
3. In the list of buckets, the retention period of each bucket is found in the `Retention policy` column. If the retention policy is locked, an image of a lock appears directly to the left of the retention period.

### Using Google Cloud CLI

1. To list all sinks destined to storage buckets:

```bash
gcloud logging sinks list --folder=FOLDER_ID | --organization=ORGANIZATION_ID | --project=PROJECT_ID
```

2. For every storage bucket listed above, verify that retention policies and Bucket Lock are enabled:

```bash
gsutil retention get gs://BUCKET_NAME
```

For more information, see https://cloud.google.com/storage/docs/using-bucket-lock#view-policy.

### Expected Result

Each storage bucket used as a log sink has a retention policy configured and Bucket Lock is enabled (locked).

## Remediation

### Using Google Cloud Console

1. If sinks are not configured, first follow the instructions in the recommendation: `Ensure that sinks are configured for all Log entries`.
2. For each storage bucket configured as a sink, go to the Cloud Storage browser at `https://console.cloud.google.com/storage/browser/<BUCKET_NAME>`.
3. Select the Bucket Lock tab near the top of the page.
4. In the Retention policy entry, click the Add Duration link. The `Set a retention policy` dialog box appears.
5. Enter the desired length of time for the retention period and click `Save policy`.
6. Set the `Lock status` for this retention policy to `Locked`.

### Using Google Cloud CLI

1. To list all sinks destined to storage buckets:

```bash
gcloud logging sinks list --folder=FOLDER_ID | --organization=ORGANIZATION_ID | --project=PROJECT_ID
```

2. For each storage bucket listed above, set a retention policy and lock it:

```bash
gsutil retention set [TIME_DURATION] gs://[BUCKET_NAME]
gsutil retention lock gs://[BUCKET_NAME]
```

For more information, visit https://cloud.google.com/storage/docs/using-bucket-lock#set-policy.

## Default Value

By default, storage buckets used as log sinks do not have retention policies and Bucket Lock configured.

## References

1. https://cloud.google.com/storage/docs/bucket-lock
2. https://cloud.google.com/storage/docs/using-bucket-lock
3. https://cloud.google.com/storage/docs/bucket-lock

## Additional Information

Caution: Locking a retention policy is an irreversible action. Once locked, you must delete the entire bucket in order to "remove" the bucket's retention policy. However, before you can delete the bucket, you must be able to delete all the objects in the bucket, which itself is only possible if all the objects have reached the retention period set by the retention policy.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |

## Profile

Level 2
