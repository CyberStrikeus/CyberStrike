---
name: cis-gworkspace-3.1.3.4.3.4
description: "Ensure protection against any unauthenticated emails is enabled"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, gmail, spoofing, phishing, email-security]
cis_id: "3.1.3.4.3.4"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: [cis-gworkspace-3.1.3.4.3.1, cis-gworkspace-3.1.3.4.3.2, cis-gworkspace-3.1.3.4.3.3, cis-gworkspace-3.1.3.4.3.5]
prerequisites: []
severity_boost: {}
---

# 3.1.3.4.3.4 Ensure protection against any unauthenticated emails is enabled

## Overview

| Property | Value |
|---|---|
| **CIS ID** | 3.1.3.4.3.4 |
| **Level** | L1 |
| **Profile Applicability** | Enterprise Level 1 |
| **Assessment Type** | Manual |
| **Section** | Gmail > Safety > Spoofing and authentication |

## Description

Displays a warning when any message is not authenticated (SPF or DKIM).

## Rationale

You should protect your users from any emails that aren't authenticated (SPF or DKIM).

## Impact

Emails that aren't authenticated (SPF or DKIM) display a warning message to the recipient.

## Default Value

`Protect against any unauthenticated emails` = **unchecked**

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to [https://admin.google.com](https://admin.google.com) as an administrator
2. Select **Apps**
3. Select **Google Workspace**
4. Select **Gmail**
5. Under `Safety` - `Spoofing and authentication`, ensure `Protect against any unauthenticated emails` is **checked**

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to [https://admin.google.com](https://admin.google.com) as an administrator
2. Select **Apps**
3. Select **Google Workspace**
4. Select **Gmail**
5. Under `Safety` - `Spoofing and authentication`, set `Protect against any unauthenticated emails` to **checked**
6. Select **Save**

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 9.5 Implement DMARC | | x | x |
| v7 | 7.8 Implement DMARC and Enable Receiver-Side Verification | | x | x |
