---
name: cis-gworkspace-3.1.3.1.2
description: "Ensure offline access to Gmail is disabled"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, gmail, offline, email-security]
cis_id: "3.1.3.1.2"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.3.1.2 Ensure offline access to Gmail is disabled

## Overview

| Property | Value |
|---|---|
| **CIS ID** | 3.1.3.1.2 |
| **Level** | L1 |
| **Profile Applicability** | Enterprise Level 1 |
| **Assessment Type** | Manual |
| **Section** | Gmail > User Settings |

## Description

Disables the user's ability to utilize various Gmail functions (read, write, search, delete, and label email messages) while not connected to the internet.

## Rationale

Prevents the organization's data (user's email) from being copied to remote computers.

## Impact

Users will need internet access to use Gmail.

## Default Value

`Enable Gmail web offline` is **unchecked**

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to [https://admin.google.com](https://admin.google.com) as an administrator
2. Select **Apps**
3. Select **Gmail**
4. Select **User Settings**
5. Under `Gmail web offline`
6. Ensure `Enable Gmail web offline` is **unchecked**

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to [https://admin.google.com](https://admin.google.com) as an administrator
2. Select **Apps**
3. Select **Gmail**
4. Select **User Settings**
5. Select `Gmail web offline`
6. Set `Enable Gmail web offline` to **unchecked**
7. Select **Save**

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | x | x |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | x | x |
