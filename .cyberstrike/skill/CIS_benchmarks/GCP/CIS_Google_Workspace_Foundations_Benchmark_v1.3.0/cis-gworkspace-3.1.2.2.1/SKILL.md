---
name: cis-gworkspace-3.1.2.2.1
description: "Ensure offline access to documents is disabled"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, drive, docs, offline]
cis_id: "3.1.2.2.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.2.2.1 Ensure offline access to documents is disabled

## Level

L1

## Profile Applicability

- Enterprise Level 1

## Type

Manual

## Description

Prevent documents from being locally accessible on an unconnected device.

## Rationale

This setting prevents an organization's files from being stored locally, thus limiting data loss issues if the device is lost or stolen.

## Impact

Copies of recent files are only synced and saved on devices if you've defined a managed policy to do so.

**NOTE:** All users will lose access to offline documents on all devices if managed devices policies are not set.

**NOTE:** Setting up policies to control offline access on individual devices is outside the scope of this Benchmark. Additional information on doing this for various device types can be found in Google documentation.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Drive and Docs`
5. Select `Features and Applications`
6. Select `Offline`
7. Ensure `Control offline access using device policies` is `checked`

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Drive and Docs`
5. Select `Features and Applications`
6. Select `Offline`
7. Set `Control offline access using device policies.` to `checked`
8. Select `Save`

## Default Value

`Control offline access using device policies` is `unchecked`

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | x | x |
