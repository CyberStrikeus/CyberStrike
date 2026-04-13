---
name: cis-gworkspace-3.1.1.3.1
description: "Ensure calendar web offline is disabled"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, calendar, sharing, external-sharing, offline]
cis_id: "3.1.1.3.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.1.3.1 Ensure calendar web offline is disabled (Manual)

## Description

Limit who is allowed offline calendar access.

## Rationale

When enabled, users can turn on offline use for each computer they use. Data is stored on the computer until offline use is turned off by the user. In this case, the organization can lose control of where its data is stored (for this user). Care should be taken regarding which users and groups have this capability enabled.

## Impact

Users will not be able to access their calendars offline.

## Audit Procedure

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Calendar`
5. Under `Advanced settings`, select `Calendar web offline`
6. Ensure `Allow using Calendar on the web when offline` is unchecked

## Expected Result

`Allow using Calendar on the web when offline` should be unchecked.

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Calendar`
5. Under `Advanced settings`, select `Calendar web offline`
6. Set `Allow using Calendar on the web when offline` to unchecked
7. Select `Save`

## Default Value

`Allow using Calendar on the web when offline` is checked

## References

- https://support.google.com/a/answer/60765

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |

## Profile

- Enterprise Level 2
