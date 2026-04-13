---
name: cis-gworkspace-3.1.3.4.2.1
description: "Ensure link identification behind shortened URLs is enabled"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, gmail, links, phishing, email-security]
cis_id: "3.1.3.4.2.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: [cis-gworkspace-3.1.3.4.2.2, cis-gworkspace-3.1.3.4.2.3]
prerequisites: []
severity_boost: {}
---

# 3.1.3.4.2.1 Ensure link identification behind shortened URLs is enabled

## Overview

| Property                  | Value                                      |
| ------------------------- | ------------------------------------------ |
| **CIS ID**                | 3.1.3.4.2.1                                |
| **Level**                 | L1                                         |
| **Profile Applicability** | Enterprise Level 1                         |
| **Assessment Type**       | Manual                                     |
| **Section**               | Gmail > Safety > Links and external images |

## Description

Identify links behind short URLs, and display a warning when you click links to untrusted domains.

## Rationale

You should protect your users from potentially malicious links.

## Impact

Users will be warned when they click links to untrusted domains.

## Default Value

`Identify links behind shortened URLs` is **checked**

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to [https://admin.google.com](https://admin.google.com) as an administrator
2. Select **Apps**
3. Select **Google Workspace**
4. Select **Gmail**
5. Under `Safety` - `Links and external images`, ensure `Identify links behind shortened URLs` is **checked**

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to [https://admin.google.com](https://admin.google.com) as an administrator
2. Select **Apps**
3. Select **Google Workspace**
4. Select **Gmail**
5. Under `Safety` - `Links and external images`, set `Identify links behind shortened URLs` to **checked**
6. Select **Save**

## CIS Controls

| Controls Version | Control                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------- | ---- | ---- | ---- |
| v8               | 9.3 Maintain and Enforce Network-Based URL Filters |      | x    | x    |
| v7               | 7.4 Maintain and Enforce Network-Based URL Filters |      | x    | x    |
