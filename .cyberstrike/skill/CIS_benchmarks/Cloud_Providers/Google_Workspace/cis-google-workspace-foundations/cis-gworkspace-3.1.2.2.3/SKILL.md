---
name: cis-gworkspace-3.1.2.2.3
description: "Ensure Add-Ons is disabled"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, drive, docs, add-ons]
cis_id: "3.1.2.2.3"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.2.2.3 Ensure Add-Ons is disabled

## Level

L1

## Profile Applicability

- Enterprise Level 1

## Type

Manual

## Description

Prevent users to install Google Docs add-ons from add-ons store.

**NOTE:** This setting controls add-on access from outside your organization.

## Rationale

Allowing uses to install unapproved Add-Ons puts the organization at risk. If users need a specific Add-On this can be handled on a case by case basis as the need, and the add-on, is approved.

## Impact

The end user will not be able to use Google Drive for desktop and its convenient integration into the Windows file explorer.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Drive and Docs`
5. Select `Features and Applications`
6. Select `Add-Ons`
7. Ensure `Allow users to install Google Docs add-ons from add-ons store.` is `unchecked`

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Drive and Docs`
5. Select `Features and Applications`
6. Select `Add-Ons`
7. Set `Allow users to install Google Docs add-ons from add-ons store.` to `unchecked`
8. Select `Save`

## Default Value

`Allow users to install Google Docs add-ons from add-ons store.` is `checked`

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running              |      | x    | x    |
