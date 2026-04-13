---
name: cis-gcp-foundations-2.2
description: "Ensure That Sinks Are Configured for All Log Entries"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, logging, monitoring, log-sinks, cloud-audit]
cis_id: "2.2"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure That Sinks Are Configured for All Log Entries (Automated)

## Description

It is recommended to create a sink that will export copies of all the log entries. This can help aggregate logs from multiple projects and export them to a Security Information and Event Management (SIEM).

## Rationale

Log entries are held in Cloud Logging. To aggregate logs, export them to a SIEM. To keep them longer, it is recommended to set up a log sink. Exporting involves writing a filter that selects the log entries to export, and choosing a destination in Cloud Storage, BigQuery, or Cloud Pub/Sub. The filter and destination are held in an object called a sink. To ensure all log entries are exported to sinks, ensure that there is no filter configured for a sink. Sinks can be created in projects, organizations, folders, and billing accounts.

## Impact

There are no costs or limitations in Cloud Logging for exporting logs, but the export destinations charge for storing or transmitting the log data.

## Audit Procedure

### Using Google Cloud Console

1. Go to `Logs Router` by visiting https://console.cloud.google.com/logs/router.
2. For every sink, click the 3-dot button for Menu options and select `View sink details`.
3. Ensure there is at least one sink with an `empty` Inclusion filter.
4. Additionally, ensure that the resource configured as `Destination` exists.

### Using Google Cloud CLI

1. Ensure that a sink with an `empty filter` exists. List the sinks for the project, folder or organization. If sinks are configured at a folder or organization level, they do not need to be configured for each project:

```bash
gcloud logging sinks list --folder=FOLDER_ID | --organization=ORGANIZATION_ID | --project=PROJECT_ID
```

The output should list at least one sink with an `empty filter`.

2. Additionally, ensure that the resource configured as `Destination` exists.

See https://cloud.google.com/sdk/gcloud/reference/beta/logging/sinks/list for more information.

### Expected Result

At least one sink with an empty filter is configured, and the destination resource exists.

## Remediation

### Using Google Cloud Console

1. Go to `Logs Router` by visiting https://console.cloud.google.com/logs/router.
2. Click on the arrow symbol with `CREATE SINK` text.
3. Fill out the fields for `Sink details`.
4. Choose Cloud Logging bucket in the Select sink destination drop down menu.
5. Choose a log bucket in the next drop down menu.
6. If an inclusion filter is not provided for this sink, all ingested logs will be routed to the destination provided above. This may result in higher than expected resource usage.
7. Click `Create Sink`.

For more information, see https://cloud.google.com/logging/docs/export/configure_export_v2#dest-create.

### Using Google Cloud CLI

To create a sink to export all log entries in a Google Cloud Storage bucket:

```bash
gcloud logging sinks create <sink-name> storage.googleapis.com/DESTINATION_BUCKET_NAME
```

Sinks can be created for a folder or organization, which will include all projects.

```bash
gcloud logging sinks create <sink-name> storage.googleapis.com/DESTINATION_BUCKET_NAME --include-children --folder=FOLDER_ID | --organization=ORGANIZATION_ID
```

Note:

1. A sink created by the command-line above will export logs in storage buckets. However, sinks can be configured to export logs into BigQuery, or Cloud Pub/Sub, or `Custom Destination`.
2. While creating a sink, the sink option `--log-filter` is not used to ensure the sink exports all log entries.
3. A sink can be created at a folder or organization level that collects the logs of all the projects underneath by passing the option `--include-children` in the gcloud command.

## Default Value

By default, there are no sinks configured.

## References

1. https://cloud.google.com/logging/docs/reference/tools/gcloud-logging
2. https://cloud.google.com/logging/quotas
3. https://cloud.google.com/logging/docs/routing/overview
4. https://cloud.google.com/logging/docs/export/using_exported_logs
5. https://cloud.google.com/logging/docs/export/configure_export_v2
6. https://cloud.google.com/logging/docs/export/aggregated_exports
7. https://cloud.google.com/sdk/gcloud/reference/beta/logging/sinks/list

## Additional Information

For Command-Line Audit and Remediation, the sink destination of type `Cloud Storage Bucket` is considered. However, the destination could be configured to `Cloud Storage Bucket` or `BigQuery` or `Cloud Pub\Sub` or `Custom Destination`. Command Line Interface commands would change accordingly.

## CIS Controls

| Controls Version | Control                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------- | ---- | ---- | ---- |
| v8               | 8.2 Collect Audit Logs                | x    | x    | x    |
| v8               | 8.3 Ensure Adequate Audit Log Storage | x    | x    | x    |
| v7               | 6.2 Activate audit logging            | x    | x    | x    |
| v7               | 6.4 Ensure adequate storage for logs  |      | x    | x    |

## Profile

Level 1
