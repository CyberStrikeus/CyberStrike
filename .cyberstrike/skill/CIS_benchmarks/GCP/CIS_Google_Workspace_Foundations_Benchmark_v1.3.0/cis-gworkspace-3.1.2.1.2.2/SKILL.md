---
name: cis-gworkspace-3.1.2.1.2.2
description: "Ensure manager access members cannot modify shared drive settings"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, drive, docs, shared-drives, file-access]
cis_id: "3.1.2.1.2.2"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.2.1.2.2 Ensure manager access members cannot modify shared drive settings

## Level

L1

## Profile Applicability

- Enterprise Level 1

## Type

Manual

## Description

Only administrators should be able to modify shared drive settings.

## Rationale

Allowing manager access members to override or modify shared drive settings can allow intentional and unintentional data access by unauthorized users.

## Impact

Disabling this feature will prevent manager access members from modifying shared drive settings, requiring administrators to perform settings modifications as required.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Drive and Docs`
5. Select `Sharing settings`
6. Under `Shared drive creation`, ensure `Allow members with manager access to override the settings below` is `unchecked`

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Drive and Docs`
5. Select `Sharing settings`
6. Under `Shared drive creation`, set `Allow members with manager access to override the settings below` to `unchecked`
7. Select `Save`

## Default Value

`Allow members with manager access to override the settings below` is `checked`

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |
