---
name: cis-gworkspace-4.2.1.2
description: "Review third-party applications periodically"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, security, api-controls, oauth, third-party-apps]
cis_id: "4.2.1.2"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2.1.2 Review third-party applications periodically

## Profile Applicability

- Enterprise Level 2

## Description

Weekly review connected applications for potential malicious or unintended access or connections.

## Rationale

Performing a periodic review of connected applications and their permission scopes ensures only permitted and required applications can access organizational data or resources. Attackers commonly attempt to persuade or trick users to grant their application access to organizational data resources by asking for their consent.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Security`
3. Select `Access and Data Control`
4. Select `API Controls`, then select `App access control`
5. Under `Overview`, select `MANAGE THIRD-PARTY APP ACCESS`
6. Ensure all listed applications have been properly vetted and authorized by the appropriate personnel

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Security`
3. Select `Access and Data Control`
4. Select `API Controls`, then select `App access control`
5. Under `Overview`, select `MANAGE THIRD-PARTY APP ACCESS`
6. Select `Change Access` for the application you wish to remove
7. Select `Blocked: Can't access any Google service`
8. Log in to the Google Cloud Platform - Resource Manager `https://console.cloud.google.com/cloud-resource-manager` as an administrator
9. Now `Delete` the desired application

## Default Value

None

## CIS Controls

| Controls Version | Control                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------- | ---- | ---- | ---- |
| v8               | 2.1 Establish and Maintain a Software Inventory | x    | x    | x    |
| v8               | 2.3 Address Unauthorized Software               | x    | x    | x    |
| v7               | 2.1 Maintain Inventory of Authorized Software   | x    | x    | x    |
| v7               | 2.6 Address unapproved software                 | x    | x    | x    |
