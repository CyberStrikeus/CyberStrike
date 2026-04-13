---
name: cis-gworkspace-3.1.6.1
description: "Ensure accessing groups from outside this organization is set to private"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, groups, external-access, permissions]
cis_id: "3.1.6.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.6.1 Ensure accessing groups from outside this organization is set to private

## Level

L1

## Profile Applicability

- Enterprise Level 1

## Type

Manual

## Description

Choose whether people outside your organization can access your groups. Group owners can further restrict access as needed.

## Rationale

Who can externally view groups internal to the organization should be carefully controlled and their access vetted as needed.

## Impact

No one outside your organization can view or search for your groups. External users can email the group if group settings allow.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Groups for Business`
5. Select `Sharing options`
6. Verify `Accessing groups from outside this organization` is `Private`

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Groups for Business`
5. Select `Sharing options`
6. Set `Accessing groups from outside this organization` to `Private`
7. Select `Save`

## Default Value

`Accessing groups from outside this organization` is `Private`

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |

## Profile

Level 1
