---
name: cis-gworkspace-3.1.2.1.2.1
description: "Ensure users can create new shared drives"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, drive, docs, shared-drives]
cis_id: "3.1.2.1.2.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.2.1.2.1 Ensure users can create new shared drives

## Level

L1

## Profile Applicability

- Enterprise Level 1

## Type

Manual

## Description

All users should have the ability to create new shared drives.

## Rationale

By default, when a user account is deleted all the data in their personal drive is deleted as well. By allowing any user to create new shared drives aids in preventing data loss when user accounts are deleted.

## Impact

Disabling this feature will prevent users from creating new shared drives.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Drive and Docs`
5. Under `Sharing settings`, select `Shared drive creation`
6. Ensure `Prevent users in <Company> from creating new shared drives` is `un-checked`

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Drive and Docs`
5. Under `Sharing settings`, select `Shared drive creation`
6. Set `Prevent users in <Company> from creating new shared drives` to `unchecked`
7. Select `Save`

## Default Value

`Prevent users in <Company> from creating new shared drives` is `unchecked`

## CIS Controls

This recommendation is not mapped to any CIS Controls.
