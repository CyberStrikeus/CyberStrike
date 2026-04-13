---
name: cis-gworkspace-3.1.7.1
description: "Ensure service status for Google Sites is set to off"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, sites, permissions]
cis_id: "3.1.7.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.7.1 Ensure service status for Google Sites is set to off

## Level

L1

## Profile Applicability

- Enterprise Level 1

## Type

Manual

## Description

By default turn off Google Sites for all users.

## Rationale

There is really no reason for every user within an organization to have access to Google Sites. If this capability is needed, it can be enabled and configured for those users and groups by exception as required by the organization to meet specific needs.

## Impact

Users will not be have access to Google Sites.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Sites`
5. Select `Service status`
6. Verify `Service status` is `OFF for everyone`

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Sites`
5. Select `Service status`
6. Set `Service status` to `OFF for everyone`
7. Select `Save`

## Default Value

`Service status` is `ON for everyone`

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | x | x |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | x | x |

## Profile

Level 1
