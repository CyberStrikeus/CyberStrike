---
name: cis-gcp-foundations-2.7
description: "Ensure That the Log Metric Filter and Alerts Exist for VPC Network Firewall Rule Changes"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, logging, monitoring, log-metrics, alerts, vpc, firewall]
cis_id: "2.7"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure That the Log Metric Filter and Alerts Exist for VPC Network Firewall Rule Changes (Automated)

## Description

It is recommended that a metric filter and alarm be established for Virtual Private Cloud (VPC) Network Firewall rule changes.

## Rationale

Monitoring for Create or Update Firewall rule events gives insight to network access changes and may reduce the time it takes to detect suspicious activity.

## Impact

Enabling of logging may result in your project being charged for the additional logs usage. These charges could be significant depending on the size of the organization.

## Audit Procedure

### Using Google Cloud Console

Ensure that the prescribed log metric is present:

1. Go to `Logging/Logs-based Metrics` by visiting https://console.cloud.google.com/logs/metrics.
2. In the `User-defined Metrics` section, ensure that at least one metric `<Log_Metric_Name>` is present with this filter text:

```
resource.type="gce_firewall_rule"
AND (protoPayload.methodName:"compute.firewalls.patch"
OR protoPayload.methodName:"compute.firewalls.insert"
OR protoPayload.methodName:"compute.firewalls.delete")
```

Ensure that the prescribed alerting policy is present:

3. Go to `Alerting` by visiting https://console.cloud.google.com/monitoring/alerting.
4. Under the `Policies` section, ensure that at least one alert policy exists for the log metric above. Clicking on the policy should show that it is configured with a condition. For example, `Violates when: Any logging.googleapis.com/user/<Log Metric Name> stream is above a threshold of zero(0) for greater than zero(0) seconds` means that the alert will trigger for any new owner change. Verify that the chosen alerting thresholds make sense for the user's organization.
5. Ensure that appropriate notification channels have been set up.

### Using Google Cloud CLI

Ensure that the prescribed log metric is present:

1. List the log metrics:

```bash
gcloud logging metrics list --format json
```

2. Ensure that the output contains at least one metric with the filter set to:

```
resource.type="gce_firewall_rule"
AND (protoPayload.methodName:"compute.firewalls.patch"
OR protoPayload.methodName:"compute.firewalls.insert"
OR protoPayload.methodName:"compute.firewalls.delete")
```

3. Note the value of the property `metricDescriptor.type` for the identified metric, in the format `logging.googleapis.com/user/<Log Metric Name>`.

Ensure that the prescribed alerting policy is present:

4. List the alerting policies:

```bash
gcloud alpha monitoring policies list --format json
```

5. Ensure that the output contains an least one alert policy where:

- `conditions.conditionThreshold.filter` is set to `metric.type=\"logging.googleapis.com/user/<Log Metric Name>\"`
- AND `enabled` is set to `true`

### Expected Result

A log metric filter exists matching the VPC firewall rule changes filter, and at least one alert policy is configured and enabled for it.

## Remediation

### Using Google Cloud Console

Create the prescribed log metric:

1. Go to `Logging/Logs-based Metrics` by visiting https://console.cloud.google.com/logs/metrics and click "CREATE METRIC".
2. Click the down arrow symbol on the `Filter Bar` at the rightmost corner and select `Convert to Advanced Filter`.
3. Clear any text and add:

```
resource.type="gce_firewall_rule"
AND (protoPayload.methodName:"compute.firewalls.patch"
OR protoPayload.methodName:"compute.firewalls.insert"
OR protoPayload.methodName:"compute.firewalls.delete")
```

4. Click `Submit Filter`. Display logs appear based on the filter text entered by the user.
5. In the `Metric Editor` menu on the right, fill out the name field. Set `Units` to `1` (default) and `Type` to `Counter`. This ensures that the log metric counts the number of log entries matching the advanced logs query.
6. Click `Create Metric`.

Create the prescribed Alert Policy:

1. Identify the newly created metric under the section `User-defined Metrics` at https://console.cloud.google.com/logs/metrics.
2. Click the 3-dot icon in the rightmost column for the new metric and select `Create alert from Metric`. A new page displays.
3. Fill out the alert policy configuration and click `Save`. Choose the alerting threshold and configuration that makes sense for the user's organization. For example, a threshold of zero(0) for the most recent value ensures that a notification is triggered for every owner change in the project:

```
Set `Aggregator` to `Count`
Set `Configuration`:
- Condition: above
- Threshold: 0
- For: most recent value
```

4. Configure the desired notifications channels in the section `Notifications`.
5. Name the policy and click `Save`.

### Using Google Cloud CLI

Create the prescribed Log Metric:

- Use the command: `gcloud logging metrics create`

Create the prescribed alert policy:

- Use the command: `gcloud alpha monitoring policies create`

## Default Value

By default, no log metrics and alert policies are configured.

## References

1. https://cloud.google.com/logging/docs/logs-based-metrics/
2. https://cloud.google.com/monitoring/custom-metrics/
3. https://cloud.google.com/monitoring/alerts/
4. https://cloud.google.com/logging/docs/reference/tools/gcloud-logging
5. https://cloud.google.com/vpc/docs/firewalls

## CIS Controls

| Controls Version | Control                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------- | ---- | ---- | ---- |
| v8               | 8.2 Collect Audit Logs          | x    | x    | x    |
| v8               | 8.5 Collect Detailed Audit Logs |      | x    | x    |
| v7               | 6.2 Activate audit logging      | x    | x    | x    |
| v7               | 6.3 Enable Detailed Logging     |      | x    | x    |

## Profile

Level 2
