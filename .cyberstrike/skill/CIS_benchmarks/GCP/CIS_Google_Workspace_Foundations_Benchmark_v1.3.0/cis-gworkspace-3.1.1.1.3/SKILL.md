---
name: cis-gworkspace-3.1.1.1.3
description: "Ensure external invitation warnings for Google Calendar are configured"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, calendar, sharing, external-sharing, offline]
cis_id: "3.1.1.1.3"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.1.1.3 Ensure external invitation warnings for Google Calendar are configured (Manual)

## Description

Configure Google Calendar to warn users when inviting guest outside your domain.

## Rationale

When your users create a Google Calendar event that includes one or more guests from outside of your domain, they are prompted to confirm whether it's OK to include external guests in the event invitation, assisting in the prevention of unintentional data leakage.

## Impact

Users will be prompted to allow the inclusion of external guests in an event invitation.

## Audit Procedure

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Calendar`
5. Under `Sharing settings`, select `External invitations`
6. Ensure `Warn users when inviting guests outside of the domain` is checked

## Expected Result

`Warn users when inviting guests outside of the domain` should be checked.

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Calendar`
5. Under `Sharing settings`, select `External Invitations`
6. Set `Warn users when inviting guests outside of the domain` to checked
7. Select `Save`

## Default Value

`Warn users when inviting guests outside of the domain` is checked

## References

- https://support.google.com/a/answer/60765

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |

## Profile

- Enterprise Level 1
