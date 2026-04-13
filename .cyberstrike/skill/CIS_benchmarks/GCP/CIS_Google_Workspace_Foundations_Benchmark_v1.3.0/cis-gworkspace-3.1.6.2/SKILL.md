---
name: cis-gworkspace-3.1.6.2
description: "Ensure creating groups is restricted"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, groups, permissions, external-access]
cis_id: "3.1.6.2"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.6.2 Ensure creating groups is restricted

## Level

L1

## Profile Applicability

- Enterprise Level 1

## Type

Manual

## Description

Control who is allowed to create Groups in your organization and if they can have external members.

## Rationale

The organization should have some control over the organizational groups created and the purpose they are for.

## Impact

In a large organization, this may cause too much burden on administrators.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Groups for Business`
5. Select `Creating groups`
6. Verify `Only organization admins can create groups` is `selected`
7. Verify `Group owners can allow external members Organization admins can always add external members` is `unchecked`
8. Verify `Group owners can allow incoming email from outside the organization` is `unchecked`

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Groups for Business`
5. Select `Creating groups`
6. Select `Only organization admins can create groups`
7. Set `Group owners can allow external members Organization admins can always add external members` to `unchecked`
8. Set `Group owners can allow incoming email from outside the organization` to `unchecked`
9. Select `Save`

## Default Value

- `Anyone in the organization can create groups` is `selected`
- `Group owners can allow external members Organization admins can always add external members` is `unchecked`
- `Group owners can allow incoming email from outside the organization` is `unchecked`

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |

## Profile

Level 1
