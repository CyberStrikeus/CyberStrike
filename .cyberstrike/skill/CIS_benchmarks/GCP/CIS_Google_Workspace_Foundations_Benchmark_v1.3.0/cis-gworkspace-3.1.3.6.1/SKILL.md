---
name: cis-gworkspace-3.1.3.6.1
description: "Ensure enhanced pre-delivery message scanning is enabled"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, gmail, spam]
cis_id: "3.1.3.6.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure enhanced pre-delivery message scanning is enabled (Manual)

## Description

Enables improved detection of suspicious content prior to delivery.

## Rationale

As an administrator, you can increase Gmail's ability to identify suspicious content with enhanced pre-delivery message scanning. Typically, when Gmail identifies a possible phishing message, a warning is displayed and the message might be moved to spam.

## Impact

With the Enhanced pre-delivery message scanning option, when Gmail detects suspicious content, message delivery is slightly delayed so that Gmail can do additional security checks on the message.

## Audit Procedure

### Using Google Workspace Admin Console

1. Log in to https://admin.google.com as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Gmail`
5. Select `Spam, phishing, and malware`
6. Ensure `Enhanced pre-delivery message scanning.` is **ON**

### Expected Result

`Enhanced pre-delivery message scanning.` should be ON.

## Remediation

### Using Google Workspace Admin Console

1. Log in to https://admin.google.com as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Gmail`
5. Select `Spam, phishing, and malware`
6. Select `Enhanced pre-delivery message scanning.`
7. Set `Enables improved detection of suspicious content prior to delivery` to **checked**
8. Select `Save`

## Default Value

`Enhanced pre-delivery message scanning.` is **ON**

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 9.7 Deploy and Maintain Email Server Anti-Malware Protections | | | x |
| v7 | 7.10 Sandbox All Email Attachments | | | x |

## Profile

Level 1
