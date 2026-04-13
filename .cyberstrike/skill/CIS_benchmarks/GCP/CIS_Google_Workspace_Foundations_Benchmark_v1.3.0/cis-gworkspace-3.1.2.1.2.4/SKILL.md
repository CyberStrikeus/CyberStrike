---
name: cis-gworkspace-3.1.2.1.2.4
description: "Ensure viewers and commenters ability to download, print, and copy files is disabled"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, drive, docs, shared-drives, file-access]
cis_id: "3.1.2.1.2.4"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.2.1.2.4 Ensure viewers and commenters ability to download, print, and copy files is disabled

## Level

L2

## Profile Applicability

- Enterprise Level 2

## Type

Manual

## Description

Limit what viewers/commenters on a shared document can do with it.

## Rationale

In many cases when sharing a document it might be fine for the users to do what they want with the document on the shared drive (Download, Print, etc.). In more restricted environments these capabilities may need to be prevented (Protected Intellectual property, Personally Identifiable Information, etc.).

## Impact

Users of this shared drive will be restricted to only reading and commenting on the existing files.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Drive and Docs`
5. Select `Sharing settings`
6. Under `Shared drive creation`, ensure `Allow viewers and commenters to download, print, and copy files` is `unchecked`

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Drive and Docs`
5. Select `Sharing settings`
6. Under `Shared drive creation`, set `Allow viewers and commenters to download, print, and copy files` to `unchecked`
7. Select `Save`

## Default Value

`Allow viewers and commenters to download, print, and copy files` is `unchecked`

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |
