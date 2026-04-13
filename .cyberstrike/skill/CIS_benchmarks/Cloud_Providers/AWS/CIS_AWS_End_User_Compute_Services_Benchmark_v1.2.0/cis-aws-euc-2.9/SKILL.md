---
name: cis-aws-euc-2.9
description: "Ensure CloudWatch is set up for WorkSpaces"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, workspaces, cloudwatch, monitoring, logging]
cis_id: "2.9"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-euc-2.8, cis-aws-euc-2.10]
prerequisites: []
severity_boost: {}
---

# Ensure CloudWatch is set up for WorkSpaces (Manual)

## Profile Applicability

- Level 1

## Description

Set up and utilize Amazon CloudWatch Events for successful logins to WorkSpaces.

## Rationale

Use Cloudwatch to store/archive WorkSpaces login events for future reference, analysis, and action based on the patterns. Utilize the IP address collected to figure out where users are logged in from, and then build policies to allow access only to files or data from those WorkSpaces that meet company access criteria. With this information you can also use policy controls to block access from unauthorized IP addresses.

## Impact

None specified in the benchmark.

## Audit Procedure

### Using AWS Console

Perform the following steps to review the rules for CloudWatch and WorkSpaces Events:

1. Login to the CloudWatch console at https://console.aws.amazon.com/cloudwatch/
2. In the left pane click **Rules**
3. Click **Rules**
4. Click on the Rule Name for your WorkSpaces Access Events
5. Confirm the **Event Pattern**:

```json
{
  "source": ["aws.workspaces"],
  "detail-type": ["WorkSpaces Access"]
}
```

6. Confirm Status is **Enabled**
7. Confirm at least one Target is created for **CloudWatch Log Group**

If there is no CloudWatch Event created with the rule as outlined above refer to the remediation below.

## Remediation

### Using AWS Console

Perform the following steps to create a Rule for CloudWatch WorkSpaces Events:

1. Login to the CloudWatch console at https://console.aws.amazon.com/cloudwatch/
2. In the left pane click **Rules**
3. Click **Create rule**
4. For Event Source, do the following:

```
- Click `Event Pattern` and Build event pattern to match events by service (the default).
```

5. For Service Name, click **WorkSpaces**
6. For Event Type, click **WorkSpaces Access**
7. For Targets, click **Add target**

```
- Click and Change the Lambda Function to `CloudWatch log group`
```

8. For Log Group, enter /aws/events/workspaces_access

**Note:** You can add additional targets for other services to act when a WorkSpaces Access event is detected.

9. Click **Configure details**
10. For Rule definition, **enter a name and description**
11. Click `Create rule`
12. Click **Create rule**

## Default Value

By default, The CloudWatch dashboard is automatically created when you use your AWS account to configure your WorkSpaces.

The dashboard consists of the following features: View historical data using time and date range controls.

Add customized dashboard view to the CloudWatch custom dashboards.

Monitor the overall health and utilization status of your WorkSpaces by doing the following:

- View the total number of provisioned WorkSpaces, number of users connected, number of unhealthy and healthy WorkSpace instances
- View unhealthy WorkSpaces and their different variables, such as protocol and compute mode
- Hover over the line chart to view the number of healthy or unhealthy WorkSpace instances for a specific protocol and running mode over a period of time
- Choose the ellipsis menu, then choose View in metrics to view the metrics on a time scale chart
- View your connection metrics and their different variables, such as number of connection attempts, successful connections, and failed connections in your WorkSpaces environment at any given time
- View InSession latencies that impact your user's experience, such as round trip time (RTT), to determine connection health and packet loss to monitor network health
- View host performance and resource utilization to identify and troubleshoot potential performance issues

https://docs.aws.amazon.com/workspaces/latest/adminguide/cloudwatch-dashboard.html

## References

1. https://docs.aws.amazon.com/workspaces/latest/adminguide/amazon-workspaces-monitoring.html
2. https://docs.aws.amazon.com/workspaces/latest/adminguide/cloudwatch-events.html

## CIS Controls

**v8:**

- 8.2 Collect Audit Logs
  - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets.
- 8.9 Centralize Audit Logs
  - Centralize, to the extent possible, audit log collection and retention across enterprise assets.

**v7:**

- 6.2 Activate audit logging
  - Ensure that local logging has been enabled on all systems and networking devices.
- 6.5 Central Log Management
  - Ensure that appropriate logs are being aggregated to a central log management system for analysis and review.
