---
name: cis-gcp-foundations-2.4
description: "Ensure Log Metric Filter and Alerts Exist for Project Ownership Assignments/Changes"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, logging, monitoring, log-metrics, alerts, iam, project-ownership]
cis_id: "2.4"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Log Metric Filter and Alerts Exist for Project Ownership Assignments/Changes (Automated)

## Description

In order to prevent unnecessary project ownership assignments to users/service-accounts and further misuses of projects and resources, all `roles/Owner` assignments should be monitored.

Members (users/Service-Accounts) with a role assignment to primitive role `roles/Owner` are project owners.

The project owner has all the privileges on the project the role belongs to. These are summarized below:

- All viewer permissions on all GCP Services within the project
- Permissions for actions that modify the state of all GCP services within the project
- Manage roles and permissions for a project and all resources within the project
- Set up billing for a project

Granting the owner role to a member (user/Service-Account) will allow that member to modify the Identity and Access Management (IAM) policy. Therefore, grant the owner role only if the member has a legitimate purpose to manage the IAM policy. This is because the project IAM policy contains sensitive access control data. Having a minimal set of users allowed to manage IAM policy will simplify any auditing that may be necessary.

## Rationale

Project ownership has the highest level of privileges on a project. To avoid misuse of project resources, the project ownership assignment/change actions mentioned above should be monitored and alerted to concerned recipients.

- Sending project ownership invites
- Acceptance/Rejection of project ownership invite by user
- Adding `role\Owner` to a user/service-account
- Removing a user/Service account from `role\Owner`

## Impact

Enabling logging may result in your project being charged for the additional logs usage.

## Audit Procedure

### Using Google Cloud Console

Ensure that the prescribed log metric is present:

1. Go to `Logging/Log-based Metrics` by visiting https://console.cloud.google.com/logs/metrics.
2. In the `User-defined Metrics` section, ensure that at least one metric `<Log_Metric_Name>` is present with filter text:

```
(protoPayload.serviceName="cloudresourcemanager.googleapis.com")
AND (ProjectOwnership OR projectOwnerInvitee)
OR (protoPayload.serviceData.policyDelta.bindingDeltas.action="REMOVE"
AND protoPayload.serviceData.policyDelta.bindingDeltas.role="roles/owner")
OR (protoPayload.serviceData.policyDelta.bindingDeltas.action="ADD"
AND protoPayload.serviceData.policyDelta.bindingDeltas.role="roles/owner")
```

Ensure that the prescribed Alerting Policy is present:

3. Go to `Alerting` by visiting https://console.cloud.google.com/monitoring/alerting.
4. Under the `Policies` section, ensure that at least one alert policy exists for the log metric above. Clicking on the policy should show that it is configured with a condition. For example, `Violates when: Any logging.googleapis.com/user/<Log Metric Name> stream is above a threshold of zero(0) for greater than zero(0) seconds` means that the alert will trigger for any new owner change. Verify that the chosen alerting thresholds make sense for your organization.
5. Ensure that the appropriate notifications channels have been set up.

### Using Google Cloud CLI

Ensure that the prescribed log metric is present:

1. List the log metrics:

```bash
gcloud logging metrics list --format json
```

2. Ensure that the output contains at least one metric with filter set to:

```
(protoPayload.serviceName="cloudresourcemanager.googleapis.com")
AND (ProjectOwnership OR projectOwnerInvitee)
OR (protoPayload.serviceData.policyDelta.bindingDeltas.action="REMOVE"
AND protoPayload.serviceData.policyDelta.bindingDeltas.role="roles/owner")
OR (protoPayload.serviceData.policyDelta.bindingDeltas.action="ADD"
AND protoPayload.serviceData.policyDelta.bindingDeltas.role="roles/owner")
```

3. Note the value of the property `metricDescriptor.type` for the identified metric, in the format `logging.googleapis.com/user/<Log Metric Name>`.

Ensure that the prescribed alerting policy is present:

4. List the alerting policies:

```bash
gcloud alpha monitoring policies list --format json
```

5. Ensure that the output contains at least one alert policy where:

- `conditions.conditionThreshold.filter` is set to `metric.type=\"logging.googleapis.com/user/<Log Metric Name>\"`
- AND `enabled` is set to `true`

### Expected Result

A log metric filter exists matching the project ownership filter, and at least one alert policy is configured and enabled for it.

## Remediation

### Using Google Cloud Console

Create the prescribed log metric:

1. Go to `Logging/Logs-based Metrics` by visiting https://console.cloud.google.com/logs/metrics and click "CREATE METRIC".
2. Click the down arrow symbol on the `Filter Bar` at the rightmost corner and select `Convert to Advanced Filter`.
3. Clear any text and add:

```
(protoPayload.serviceName="cloudresourcemanager.googleapis.com")
AND (ProjectOwnership OR projectOwnerInvitee)
OR (protoPayload.serviceData.policyDelta.bindingDeltas.action="REMOVE"
AND protoPayload.serviceData.policyDelta.bindingDeltas.role="roles/owner")
OR (protoPayload.serviceData.policyDelta.bindingDeltas.action="ADD"
AND protoPayload.serviceData.policyDelta.bindingDeltas.role="roles/owner")
```

4. Click `Submit Filter`. The logs display based on the filter text entered by the user.
5. In the `Metric Editor` menu on the right, fill out the name field. Set `Units` to `1` (default) and the `Type` to `Counter`. This ensures that the log metric counts the number of log entries matching the advanced logs query.
6. Click `Create Metric`.

Create the display prescribed Alert Policy:

1. Identify the newly created metric under the section `User-defined Metrics` at https://console.cloud.google.com/logs/metrics.
2. Click the 3-dot icon in the rightmost column for the desired metric and select `Create alert from Metric`. A new page opens.
3. Fill out the alert policy configuration and click `Save`. Choose the alerting threshold and configuration that makes sense for the user's organization. For example, a threshold of zero(0) for the most recent value will ensure that a notification is triggered for every owner change in the project:

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

Create a prescribed Log Metric:

- Use the command: `gcloud beta logging metrics create`
- Reference for Command Usage: https://cloud.google.com/sdk/gcloud/reference/beta/logging/metrics/create

Create prescribed Alert Policy:

- Use the command: `gcloud alpha monitoring policies create`
- Reference for Command Usage: https://cloud.google.com/sdk/gcloud/reference/alpha/monitoring/policies/create

## Default Value

By default, no log metrics and alert policies are configured.

## References

1. https://cloud.google.com/logging/docs/logs-based-metrics/
2. https://cloud.google.com/monitoring/custom-metrics/
3. https://cloud.google.com/monitoring/alerts/
4. https://cloud.google.com/logging/docs/reference/tools/gcloud-logging

## Additional Information

1. Project ownership assignments for a user cannot be done using the gcloud utility as assigning project ownership to a user requires sending, and the user accepting, an invitation.
2. Project Ownership assignment to a service account does not send any invites. SetIAMPolicy to `role/owner` is directly performed on service accounts.

## CIS Controls

| Controls Version | Control                    | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------- | ---- | ---- | ---- |
| v8               | 8.2 Collect Audit Logs     | x    | x    | x    |
| v7               | 6.2 Activate audit logging | x    | x    | x    |

## Profile

Level 1
