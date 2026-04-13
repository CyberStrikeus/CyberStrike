---
name: cis-gworkspace-3.1.2.1.1.5
description: "Ensure Access Checker is configured to limit file access"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, drive, docs, sharing, file-access]
cis_id: "3.1.2.1.1.5"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.2.1.1.5 Ensure Access Checker is configured to limit file access

## Level

L1

## Profile Applicability

- Enterprise Level 1

## Type

Manual

## Description

When a user shares a file via a Google product other than Docs or Drive (e.g. by pasting a link in Gmail), Google can check that the recipients have access. If not, when possible, Google will ask the user to pick how they want to share the file.

## Rationale

In general, access should be restricted to the smallest group possible. In this case recipients only.

## Impact

Only recipients can access files. Recipients cannot share access with others by forwarding the email/link.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Drive and Docs`
4. Select `Sharing Settings`
5. Select `Sharing Options`
6. Under `Access Checker`
7. Ensure `Recipients only.` is `checked`

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Drive and Docs`
4. Select `Sharing Settings`
5. Select `Sharing Options`
6. Under `Access Checker`
7. Set `Recipients only.` to `checked`
8. Select `Save`

## Default Value

`Recipients only, suggested target audience, or public (no Google account required).` is `checked`

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |
