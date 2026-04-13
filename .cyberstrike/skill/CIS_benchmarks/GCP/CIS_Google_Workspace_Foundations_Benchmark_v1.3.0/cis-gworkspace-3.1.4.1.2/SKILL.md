---
name: cis-gworkspace-3.1.4.1.2
description: "Ensure internal filesharing in Google Chat and Hangouts is disabled"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, google-chat, filesharing]
cis_id: "3.1.4.1.2"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure internal filesharing in Google Chat and Hangouts is disabled (Manual)

## Description

Control how files are shared internally in Google Chat and Hangouts.

## Rationale

Files often contain confidential information, and some organizations, particularly in regulated industries, need to control the flow of this information within and outside of their organization.

## Impact

Users will not be able to share files via chat internally.

## Audit Procedure

### Using Google Workspace Admin Console

1. Log in to https://admin.google.com as an administrator
2. Select `Apps`
3. Select `Google Chat and classic Hangouts`
4. Select `Chat File Sharing`
5. Under `Setting`, verify `Internal filesharing` is set to `No files`

### Expected Result

`Internal filesharing` should be set to `No files`.

## Remediation

### Using Google Workspace Admin Console

1. Log in to https://admin.google.com as an administrator
2. Select `Apps`
3. Select `Google Chat and classic Hangouts`
4. Select `Chat File Sharing`
5. Under `Setting`, set `Internal filesharing` to `No files`
6. Select `Save`

## Default Value

`Internal filesharing` is `Allow all files`

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | x    | x    |

## Profile

Level 2
