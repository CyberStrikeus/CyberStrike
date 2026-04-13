---
name: cis-gworkspace-3.1.9.1.1
description: "Ensure users access to Google Workspace Marketplace apps is restricted"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, marketplace, permissions, external-access]
cis_id: "3.1.9.1.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.9.1.1 Ensure users access to Google Workspace Marketplace apps is restricted

## Level

L1

## Profile Applicability

- Enterprise Level 1

## Type

Manual

## Description

Restrict what Google Marketplace apps a user can install.

## Rationale

Users should only be allowed to install approved and vetted apps. This will limit the overall attack surface for the organization.

## Impact

Users can only install approved Google Marketplace apps. This list will have to be created and maintained.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace Marketplace apps`
4. Select `Settings`
5. Under `Manage Google Workspace Marketplace allowlist access`, verify `Settings to install third-party Google Workspace Marketplace apps:` is set to `Allow users to install and run only selected apps from the Marketplace`

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace Marketplace apps`
4. Select `Settings`
5. Under `Manage Google Workspace Marketplace allowlist access`, set `Settings to install third-party Google Workspace Marketplace apps:` to `Allow users to install and run only selected apps from the Marketplace`
6. Select `Save`

## Default Value

`Settings to install third-party Google Workspace Marketplace apps:` is `Allow users to install and run any app from the Marketplace`

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |

## Profile

Level 1
