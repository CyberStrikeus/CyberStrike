---
name: cis-gworkspace-3.1.2.1.1.6
description: "Ensure only users inside your organization can distribute content externally"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, drive, docs, sharing, file-access]
cis_id: "3.1.2.1.1.6"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.2.1.1.6 Ensure only users inside your organization can distribute content externally

## Level

L1

## Profile Applicability

- Enterprise Level 1

## Type

Manual

## Description

You should control who is allowed to distribute organizational content to shared drives owned by another organization.

## Rationale

Sharing and collaboration are key; however, only your users should have the authority over where company content is shared with to prevent unauthorized disclosures of information.

## Impact

Only people in your organization with Manager access to a shared drive can move files from that shared drive to a Drive location in a different organization.

In addition, users in the selected organizational unit or group can copy content from their My Drive to a shared drive owned by a different organization.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Drive and Docs`
5. Under `Sharing settings`, select `Sharing options`
6. Under `Distributing content outside of <Company>`, ensure `Only users in <Company>` is `selected`

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Drive and Docs`
5. Under `Sharing settings`, select `Sharing options`
6. Under `Distributing content outside of <Company>`, select `Only users in <Company>`
7. Select `Save`

## Default Value

`Distributing content outside of <Company>` is `Anyone`

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |
