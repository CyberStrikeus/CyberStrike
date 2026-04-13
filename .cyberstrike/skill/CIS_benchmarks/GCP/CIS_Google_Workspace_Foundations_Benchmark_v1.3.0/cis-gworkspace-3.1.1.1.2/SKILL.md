---
name: cis-gworkspace-3.1.1.1.2
description: "Ensure internal sharing options for primary calendars are configured"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, calendar, sharing, external-sharing, offline]
cis_id: "3.1.1.1.2"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.1.1.2 Ensure internal sharing options for primary calendars are configured (Manual)

## Description

Control how much calendar information users in your organization can share internally.

## Rationale

In general, not everyone in the organization needs to know the schedule details of everyone else (operational security). Free/busy indication is enough for most people.

## Impact

This will be the default for the user's primary calendar. The user can override this setting to allow other specific users greater visibility of their calendar.

## Audit Procedure

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Calendar`
5. Under `Sharing settings`, select `Internal sharing options for primary calendars`
6. Ensure `Only free/busy information (hide event details)` is selected

## Expected Result

`Only free/busy information (hide event details)` should be selected for internal sharing options for primary calendars.

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Calendar`
5. Under `Sharing settings`, select `Internal sharing options for primary calendars`
6. Select `Only free/busy information (hide event details)`
7. Select `Save`

## Default Value

`Internal sharing options for primary calendars` is `Share all information`

## References

- https://support.google.com/a/answer/60765

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |

## Profile

- Enterprise Level 2
