---
name: cis-gworkspace-3.1.1.2.1
description: "Ensure external sharing options for secondary calendars are configured"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, calendar, sharing, external-sharing, offline]
cis_id: "3.1.1.2.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.1.2.1 Ensure external sharing options for secondary calendars are configured (Manual)

## Description

Control how much calendar information users in your organization can share externally.

## Rationale

Prevent data leakage by restricting the amount of information is externally viewable when a user shares their calendar with someone external to your organization.

## Impact

- Once you limit external sharing for your organization, users can't exceed these limits when sharing individual events. For example, if you limit your organization's external sharing to Free/Busy, events with Public visibility are only shared as Free/Busy.
- External mobile users who previously synced events may keep seeing restricted details. That access stops when their device is wiped and re-synced.
- If you lower the external sharing level, people outside your organization may lose access to calendars they could previously see.

## Audit Procedure

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Calendar`
5. Under `General settings`, select `External sharing options for secondary calendars`
6. Ensure `Only free/busy information (hide event details)` is selected

## Expected Result

`Only free/busy information (hide event details)` should be selected for external sharing options for secondary calendars.

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Calendar`
5. Under `General settings`, select `External sharing options for secondary calendars`
6. Select `Only free/busy information (hide event details)`
7. Select `Save`

## Default Value

`External sharing options for secondary calendars` is `Share all information, but outsiders cannot change calendars`

## References

- https://support.google.com/a/answer/60765

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |

## Profile

- Enterprise Level 1
