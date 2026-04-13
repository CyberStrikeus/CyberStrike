---
name: cis-gworkspace-3.1.3.4.1.3
description: "Ensure protection against anomalous attachment types in emails is enabled"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, gmail, attachments, phishing, email-security]
cis_id: "3.1.3.4.1.3"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: [cis-gworkspace-3.1.3.4.1.1, cis-gworkspace-3.1.3.4.1.2]
prerequisites: []
severity_boost: {}
---

# 3.1.3.4.1.3 Ensure protection against anomalous attachment types in emails is enabled

## Overview

| Property                  | Value                        |
| ------------------------- | ---------------------------- |
| **CIS ID**                | 3.1.3.4.1.3                  |
| **Level**                 | L1                           |
| **Profile Applicability** | Enterprise Level 1           |
| **Assessment Type**       | Manual                       |
| **Section**               | Gmail > Safety > Attachments |

## Description

As a Google Workspace administrator, you can protect incoming mail against phishing and harmful software (malware). You can also choose what action to take based on the type of threat detected.

## Rationale

You should protect your users from potentially malicious attachments.

## Impact

Users will be warned when they receive an anomalous attachment.

## Default Value

`Protect against anomalous attachment types in emails` is **Unchecked**

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to [https://admin.google.com](https://admin.google.com) as an administrator
2. Select **Apps**
3. Select **Google Workspace**
4. Select **Gmail**
5. Under `Safety` - `Attachments`, ensure `Protect against anomalous attachment types in emails` is **checked**

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to [https://admin.google.com](https://admin.google.com) as an administrator
2. Select **Apps**
3. Select **Google Workspace**
4. Select **Gmail**
5. Under `Safety` - `Attachments`, set `Protect against anomalous attachment types in emails` to **checked**
6. Select **Save**

## CIS Controls

| Controls Version | Control                          | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------- | ---- | ---- | ---- |
| v8               | 9.6 Block Unnecessary File Types |      | x    | x    |
| v7               | 7.9 Block Unnecessary File Types |      | x    | x    |
