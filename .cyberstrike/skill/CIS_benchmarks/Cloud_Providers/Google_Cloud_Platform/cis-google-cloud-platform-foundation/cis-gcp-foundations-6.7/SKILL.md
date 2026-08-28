---
name: cis-gcp-foundations-6.7
description: "Ensure That Cloud SQL Database Instances Are Configured With Automated Backups"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, cloud-sql, backups]
cis_id: "6.7"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.7 Ensure That Cloud SQL Database Instances Are Configured With Automated Backups (Automated)

## Profile Applicability

- Level 1

## Description

It is recommended to have all SQL database instances set to enable automated backups.

## Rationale

Backups provide a way to restore a Cloud SQL instance to recover lost data or recover from a problem with that instance. Automated backups need to be set for any instance that contains data that should be protected from loss or damage. This recommendation is applicable for SQL Server, PostgreSql, MySql generation 1 and MySql generation 2 instances.

## Impact

Automated Backups will increase required size of storage and costs associated with it.

## Audit

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console by visiting https://console.cloud.google.com/sql/instances.
2. Click the instance name to open its instance details page.
3. Go to the `Backups` menu.
4. Ensure that `Automated backups` is set to `Enabled` and `Backup time` is mentioned.

### From Google Cloud CLI

1. List all Cloud SQL database instances using the following command:

```bash
gcloud sql instances list --format=json | jq '. | map(select(.instanceType != "READ_REPLICA_INSTANCE")) | .[].name'
```

NOTE: gcloud command has been added with the filter to exclude read-replicas instances, as GCP do not provide Automated Backups for read-replica instances.

2. Ensure that the below command returns `True` for every Cloud SQL database instance.

```bash
gcloud sql instances describe <INSTANCE_NAME> --format="value('Enabled':settings.backupConfiguration.enabled)"
```

## Remediation

### From Google Cloud Console

1. Go to the Cloud SQL Instances page in the Google Cloud Console by visiting https://console.cloud.google.com/sql/instances.
2. Select the instance where the backups need to be configured.
3. Click `Edit`.
4. In the `Backups` section, check `Enable automated backups`, and choose a backup window.
5. Click `Save`.

### From Google Cloud CLI

1. List all Cloud SQL database instances using the following command:

```bash
gcloud sql instances list --format=json | jq '. | map(select(.instanceType != "READ_REPLICA_INSTANCE")) | .[].name'
```

NOTE: gcloud command has been added with the filter to exclude read-replicas instances, as GCP do not provide Automated Backups for read-replica instances.

2. Enable `Automated backups` for every Cloud SQL database instance using the below command:

```bash
gcloud sql instances patch <INSTANCE_NAME> --backup-start-time <[HH:MM]>
```

The `backup-start-time` parameter is specified in 24-hour time, in the UTC+00 time zone, and specifies the start of a 4-hour backup window. Backups can start any time during the backup window.

## Default Value

By default, automated backups are not configured for Cloud SQL instances.

## References

1. https://cloud.google.com/sql/docs/mysql/backup-recovery/backups
2. https://cloud.google.com/sql/docs/postgres/backup-recovery/backups
3. https://cloud.google.com/sql/docs/sqlserver/backup-recovery/backups
4. https://cloud.google.com/sql/docs/mysql/backup-recovery/backing-up
5. https://cloud.google.com/sql/docs/postgres/backup-recovery/backing-up
6. https://cloud.google.com/sql/docs/sqlserver/backup-recovery/backing-up

## CIS Controls

| Controls Version | Control                                | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------- | ---- | ---- | ---- |
| v8               | 11.2 Perform Automated Backups         | X    | X    | X    |
| v7               | 10.1 Ensure Regular Automated Back Ups | X    | X    | X    |
