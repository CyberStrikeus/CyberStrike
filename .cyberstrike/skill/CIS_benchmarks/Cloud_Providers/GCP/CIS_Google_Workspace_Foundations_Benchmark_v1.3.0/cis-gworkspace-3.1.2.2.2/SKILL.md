---
name: cis-gworkspace-3.1.2.2.2
description: "Ensure desktop access to Drive is disabled"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, drive, docs, desktop-access]
cis_id: "3.1.2.2.2"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.2.2.2 Ensure desktop access to Drive is disabled

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

**NOTE:** The Google Drive desktop application has its own way of handling "Offline" files and does not obey the `Drive and Doc` > `Offline` > `Control offline access using device policies` setting. Not allowing Google Drive for desktop on the device will prevent this channel.

## Impact

The end user will not be able to use Google Drive for desktop and its convenient integration into the Windows file explorer.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Drive and Docs`
5. Select `Features and Applications`
6. Select `Google Drive for desktop`
7. Ensure `Allow Google Drive for desktop in your organization` is `unchecked`

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Drive and Docs`
5. Select `Features and Applications`
6. Select `Google Drive for desktop`
7. Set `Allow Google Drive for desktop in your organization` to `unchecked`
8. Select `Save`

## Default Value

`Allow Google Drive for desktop in your organization` is `checked`

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running              |      | x    | x    |
