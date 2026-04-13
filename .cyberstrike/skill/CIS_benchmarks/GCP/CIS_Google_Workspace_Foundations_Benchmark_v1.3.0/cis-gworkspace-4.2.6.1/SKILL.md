---
name: cis-gworkspace-4.2.6.1
description: "Ensure less secure app access is disabled"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, security, less-secure-apps, oauth, access-control]
cis_id: "4.2.6.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2.6.1 Ensure less secure app access is disabled

## Profile Applicability

- Enterprise Level 1

## Description

Configure Google Workspace security settings to prevent access to less secure apps.

## Rationale

You can block sign-in attempts from some apps or devices that are less secure. Apps that are less secure don't use modern security standards, such as OAuth. Using apps and devices that don't use modern security standards increases the risk of accounts being compromised. Blocking these apps and devices helps keep your users and data safe.

## Impact

The potential impact associated with implementation of this setting is that users won't be able to turn on access to less secure apps. When you disable access to less secure apps while a less secure app has an open connection with a user account, the app will time out when it tries to refresh the connection. Timeout periods vary per app.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Security`
3. Select `Access and Data Control`
4. Select `Less secure apps`
5. Ensure `Disable access to less secure apps (Recommended)` is `selected`

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Security`
3. Select `Access and Data Control`
4. Select `Less secure apps`
5. Select `Disable access to less secure apps (Recommended)`
6. Click `Save` to commit this configuration change.

## Default Value

`Disable access to less secure apps (Recommended)` is `selected`
