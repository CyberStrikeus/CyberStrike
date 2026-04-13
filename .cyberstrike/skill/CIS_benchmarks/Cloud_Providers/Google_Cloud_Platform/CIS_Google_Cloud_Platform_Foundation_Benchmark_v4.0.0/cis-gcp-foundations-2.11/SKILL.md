---
name: cis-gcp-foundations-2.11
description: "Ensure That the Log Metric Filter and Alerts Exist for SQL Instance Configuration Changes"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, logging, monitoring, log-metrics, alerts, cloud-sql, database]
cis_id: "2.11"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.11 Ensure That the Log Metric Filter and Alerts Exist for SQL Instance Configuration Changes (Automated)

## Profile Applicability

- Level 2

## Description

It is recommended that a metric filter and alarm be established for SQL instance configuration changes.

## Rationale

Monitoring changes to SQL instance configuration changes may reduce the time needed to detect and correct misconfigurations done on the SQL server.

Below are a few of the configurable options which may impact the security posture of an SQL instance:

- Enable auto backups and high availability: Misconfiguration may adversely impact business continuity, disaster recovery, and high availability
- Authorize networks: Misconfiguration may increase exposure to untrusted networks

## Impact

Enabling of logging may result in your project being charged for the additional logs usage. These charges could be significant depending on the size of the organization.

## Audit

### From Google Cloud Console

Ensure the prescribed log metric is present:

1. For each project that contains Cloud SQL instances, go to `Logging/Logs-based Metrics` by visiting https://console.cloud.google.com/logs/metrics.
2. In the `User-defined Metrics` section, ensure that at least one metric `<Log_Metric_Name>` is present with the filter text:

```
protoPayload.methodName="cloudsql.instances.update"
```

Ensure the prescribed alerting policy is present:

3. Go to `Alerting` by visiting https://console.cloud.google.com/monitoring/alerting.
4. Under the `Policies` section, ensure that at least one alert policy exists for the log metric above. Clicking on the policy should show that it is configured with a condition. For example, `Violates when: Any logging.googleapis.com/user/<Log Metric Name> stream is above a threshold of zero(0) for greater than zero(0) seconds` means that the alert will trigger for any new owner change. Verify that the chosen alerting thresholds make sense for the user's organization.
5. Ensure that the appropriate notifications channels have been set up.

### From Google Cloud CLI

Ensure the prescribed log metric is present:

1. List the log metrics:

```bash
gcloud logging metrics list --format json
```

2. Ensure that the output contains at least one metric with the filter set to:

```
protoPayload.methodName="cloudsql.instances.update"
```

3. Note the value of the property `metricDescriptor.type` for the identified metric, in the format `logging.googleapis.com/user/<Log Metric Name>`.

Ensure the prescribed alerting policy is present:

4. List the alerting policies:

```bash
gcloud alpha monitoring policies list --format json
```

5. Ensure that the output contains at least one alert policy where:
   - `conditions.conditionThreshold.filter` is set to `metric.type=\"logging.googleapis.com/user/<Log Metric Name>\"`
   - AND `enabled` is set to `true`

## Remediation

### From Google Cloud Console

Create the prescribed Log Metric:

1. Go to `Logging/Logs-based Metrics` by visiting https://console.cloud.google.com/logs/metrics and click "CREATE METRIC".
2. Click the down arrow symbol on the `Filter Bar` at the rightmost corner and select `Convert to Advanced Filter`.
3. Clear any text and add:

```
protoPayload.methodName="cloudsql.instances.update"
```

4. Click `Submit Filter`. Display logs appear based on the filter text entered by the user.
5. In the `Metric Editor` menu on right, fill out the name field. Set `Units` to `1` (default) and `Type` to `Counter`. This ensures that the log metric counts the number of log entries matching the user's advanced logs query.
6. Click `Create Metric`.

Create the prescribed alert policy:

1. Identify the newly created metric under the section `User-defined Metrics` at https://console.cloud.google.com/logs/metrics.
2. Click the 3-dot icon in the rightmost column for the new metric and select `Create alert from Metric`. A new page appears.
3. Fill out the alert policy configuration and click `Save`. Choose the alerting threshold and configuration that makes sense for the user's organization. For example, a threshold of zero(0) for the most recent value will ensure that a notification is triggered for every owner change in the user's project:

```
Set `Aggregator` to `Count`

Set `Configuration`:
- Condition: above
- Threshold: 0
- For: most recent value
```

4. Configure the desired notification channels in the section `Notifications`.
5. Name the policy and click `Save`.

### From Google Cloud CLI

Create the prescribed log metric:

- Use the command: `gcloud logging metrics create`

Create the prescribed alert policy:

- Use the command: `gcloud alpha monitoring policies create`
- Reference for command usage: https://cloud.google.com/sdk/gcloud/reference/alpha/monitoring/policies/create

## References

1. https://cloud.google.com/logging/docs/logs-based-metrics/
2. https://cloud.google.com/monitoring/custom-metrics/
3. https://cloud.google.com/monitoring/alerts/
4. https://cloud.google.com/logging/docs/reference/tools/gcloud-logging
5. https://cloud.google.com/storage/docs/overview
6. https://cloud.google.com/sql/docs/
7. https://cloud.google.com/sql/docs/mysql/
8. https://cloud.google.com/sql/docs/postgres/

## CIS Controls

| Controls Version | Control                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------- | ---- | ---- | ---- |
| v8               | 8.2 Collect Audit Logs          | x    | x    | x    |
| v8               | 8.5 Collect Detailed Audit Logs |      | x    | x    |
| v7               | 6.2 Activate audit logging      | x    | x    | x    |
| v7               | 6.3 Enable Detailed Logging     |      | x    | x    |
