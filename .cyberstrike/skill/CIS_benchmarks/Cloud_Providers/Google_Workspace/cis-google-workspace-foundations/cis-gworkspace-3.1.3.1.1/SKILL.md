---
name: cis-gworkspace-3.1.3.1.1
description: "Ensure users cannot delegate access to their mailbox"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, gmail, delegation, email-security]
cis_id: "3.1.3.1.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.3.1.1 Ensure users cannot delegate access to their mailbox

## Overview

| Property                  | Value                 |
| ------------------------- | --------------------- |
| **CIS ID**                | 3.1.3.1.1             |
| **Level**                 | L1                    |
| **Profile Applicability** | Enterprise Level 1    |
| **Assessment Type**       | Manual                |
| **Section**               | Gmail > User Settings |

## Description

Mail delegation allows the delegate to read, send, and delete messages on their behalf. For example, a manager can delegate Gmail access to another person in their organization, such as an administrative assistant.

## Rationale

Only administrators should be able to delegate access to a user's mailboxes.

## Impact

Existing delegations will be hidden, when this feature is disabled.

## Default Value

`Let users delegate access to their mailbox to other users in the domain` is **unchecked**

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to [https://admin.google.com](https://admin.google.com) as an administrator
2. Select **Apps**
3. Select **Google Workspace**
4. Select **Gmail**
5. Under `User Settings` - `Mail delegation`, ensure `Let users delegate access to their mailbox to other users in the domain` is **unchecked**

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to [https://admin.google.com](https://admin.google.com) as an administrator
2. Select **Apps**
3. Select **Google Workspace**
4. Select **Gmail**
5. Under `User Settings` - `Mail delegation`, set `Let users delegate access to their mailbox to other users in the domain` to **unchecked**
6. Select **Save**

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |
