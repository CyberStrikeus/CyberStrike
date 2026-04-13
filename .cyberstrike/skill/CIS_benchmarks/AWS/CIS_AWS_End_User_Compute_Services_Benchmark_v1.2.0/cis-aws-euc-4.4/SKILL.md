---
name: cis-aws-euc-4.4
description: "Utilize site wide activity feed for monitoring"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, workdocs, monitoring, logging, audit]
cis_id: "4.4"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Utilize site wide activity feed for monitoring (Manual)

## Profile Applicability

- Level 1

## Description

Admins can view and export the activity feed for an entire WorkDocs site.

## Rationale

WorkDoc admins should monitor and export activity feeds for the site as record of activity. These activity reports should be reviewed every month for any abnormalities and rotated every 90 days.

## Impact

To use this feature, you must first install the Amazon WorkDocs Companion.

## Audit Procedure

Perform the steps below to view site-wide activity feed.

### Using WorkDocs Web Application

1. Click **Activity feed**
2. Click Filter, then Click **Site-wide activity**
3. Select Activity Type filters and choose **Date Modified** settings as needed, then click **Apply**
4. When the filtered activity feed results appear, search by file, folder, or user name to narrow your results. You can also add or remove filters as needed

### Using AWS Console

Not applicable - must be accessed via WorkDocs web application.

## Expected Result

Site-wide activity feed is being monitored and exported regularly.

## Remediation

### Using WorkDocs Web Application

Perform the following steps to Export site-wide activity feed:

1. Click **Activity feed**
2. Click Filter, then Click **Site-wide activity**
3. Select Activity Type filters and choose **Date Modified** settings as needed, then click **Apply**
4. When the filtered activity feed results appear, search by file, folder, or user name to narrow your results. You can also add or remove filters as needed
5. Click **Export**
6. Export the activity feed as a .csv or .json file. Any filters you applied are reflected in the exported file

### Using AWS CLI

Not applicable - must be configured via WorkDocs web application.

## Default Value

By default, site wide monitoring is not enabled and requires additional configuration to enable the feature.

## References

1. https://docs.aws.amazon.com/workdocs/latest/adminguide/site-activity.html
2. https://amazonworkdocs.com/apps.html
3. https://docs.aws.amazon.com/workdocs/latest/userguide/activity_feed.html
4. https://docs.aws.amazon.com/workdocs/latest/adminguide/site-activity.html

## CIS Controls

**v8:**
- 8.2 Collect Audit Logs
  - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets.

**v7:**
- 6.2 Activate audit logging
  - Ensure that local logging has been enabled on all systems and networking devices.

## Profile

Level 1
