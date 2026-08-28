---
name: cis-gworkspace-3.1.3.4.3.1
description: "Ensure protection against domain spoofing based on similar domain names is enabled"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, gmail, spoofing, phishing, email-security]
cis_id: "3.1.3.4.3.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with:
  [cis-gworkspace-3.1.3.4.3.2, cis-gworkspace-3.1.3.4.3.3, cis-gworkspace-3.1.3.4.3.4, cis-gworkspace-3.1.3.4.3.5]
prerequisites: []
severity_boost: {}
---

# 3.1.3.4.3.1 Ensure protection against domain spoofing based on similar domain names is enabled

## Overview

| Property                  | Value                                        |
| ------------------------- | -------------------------------------------- |
| **CIS ID**                | 3.1.3.4.3.1                                  |
| **Level**                 | L1                                           |
| **Profile Applicability** | Enterprise Level 1                           |
| **Assessment Type**       | Manual                                       |
| **Section**               | Gmail > Safety > Spoofing and authentication |

## Description

Moves domain spoofing emails to spam folder.

## Rationale

You should protect your users from domain spoofing emails.

## Impact

Domain spoofed emails will be moved to a user's spam folder.

## Default Value

- `Protect against domain spoofing based on similar domain names` is **checked**
- `Action` is `Keep email in inbox and show warning (default)`

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to [https://admin.google.com](https://admin.google.com) as an administrator
2. Select **Apps**
3. Select **Google Workspace**
4. Select **Gmail**
5. Under `Safety` - `Spoofing and authentication`, ensure `Protect against domain spoofing based on similar domain names` is **checked**
6. Ensure `Action` is `Move email to spam`

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to [https://admin.google.com](https://admin.google.com) as an administrator
2. Select **Apps**
3. Select **Google Workspace**
4. Select **Gmail**
5. Under `Safety` - `Spoofing and authentication`, set `Protect against domain spoofing based on similar domain names` to **checked**
6. Set `Action` to `Move email to spam`
7. Select **Save**

## CIS Controls

| Controls Version | Control                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------- | ---- | ---- | ---- |
| v8               | 9.3 Maintain and Enforce Network-Based URL Filters |      | x    | x    |
| v7               | 7.4 Maintain and Enforce Network-Based URL Filters |      | x    | x    |
