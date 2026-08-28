---
name: cis-gworkspace-3.1.2.1.1.4
description: "Ensure users are warned when they share a file with users in an allowlisted domain"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, drive, docs, sharing, file-access]
cis_id: "3.1.2.1.1.4"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.2.1.1.4 Ensure users are warned when they share a file with users in an allowlisted domain

## Level

L2

## Profile Applicability

- Enterprise Level 2

## Type

Manual

## Description

Warn the user when they try and share a file and/or shared drive with users in an allowlisted domain.

## Rationale

The user may not realize the potential account is external to the organization. Providing a warning allows the user an opportunity to know this and possibly reassess this sharing.

## Impact

None, except an additional warning. Sharing can still occur.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Drive and Docs`
4. Select `Sharing Settings`
5. Select `Sharing Options`
6. Under `Sharing outside of <Company>`
7. Ensure `ALLOWLISTED DOMAINS - Files owned by users or shared drives in BMDT-Group can be shared with Google accounts in compatible allowlisted domains` is `checked`. Also, ensure the sub-setting `Warn when files owned by users or shared drives in <Company> are shared with users in allowlisted domains` is `checked`.

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Drive and Docs`
4. Select `Sharing Settings`
5. Select `Sharing Options`
6. Under `Sharing outside of <Company>`
7. Set `ALLOWLISTED DOMAINS - Files owned by users or shared drives in BMDT-Group can be shared with Google accounts in compatible allowlisted domains.` to `checked`. Also, set the sub-setting `Warn when files owned by users or shared drives in <Company> are shared with users in allowlisted domains` to `checked`.
8. Select `Save`

## Default Value

`For files owned by users in <Company> warn when sharing outside of <Company>` is `checked`

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running              |      | x    | x    |
