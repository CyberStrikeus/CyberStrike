---
name: cis-gworkspace-4.2.1.4
description: "Review domain-wide delegation for applications periodically"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, security, api-controls, oauth, domain-wide-delegation]
cis_id: "4.2.1.4"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2.1.4 Review domain-wide delegation for applications periodically

## Profile Applicability

- Enterprise Level 2

## Description

Weekly review domain-wide delegations for applications for potentially malicious or unintended access or connections.

## Rationale

Domain-wide delegation is a powerful feature that allows apps to access users' data across your organization's entire Workspace account. Performing a periodic review of domain-wide delegations for applications and their permission scopes ensures only permitted and required applications can access organizational data or resources.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Security`
3. Select `Access and Data Control`
4. Select `API Controls`
5. Under `Domain wide delegation`, select `MANAGE DOMAIN WIDE DELEGATION`
6. Ensure all listed applications have been properly vetted and authorized by the appropriate personnel

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Security`
3. Select `Access and Data Control`
4. Select `API Controls`
5. Under `Domain wide delegation`, select `MANAGE DOMAIN WIDE DELEGATION`
6. Select `Change Access` for the application you wish to remove
7. Now `Delete` the desired application

## Default Value

None

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |
