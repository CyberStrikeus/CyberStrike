---
name: cis-gworkspace-3.1.2.1.1.1
description: "Ensure users are warned when they share a file outside their domain"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, drive, docs, sharing, file-access]
cis_id: "3.1.2.1.1.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.2.1.1.1 Ensure users are warned when they share a file outside their domain

## Level

L1

## Profile Applicability

- Enterprise Level 1

## Type

Manual

## Description

Warn the user when they try and share a file and/or shared drive externally.

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
7. Ensure `ON - Files owned by users in <Company> can be shared outside of <Company>. This applies to files in all shared drives as well.` is `checked`. Also, ensure the sub-setting `For files owned by users in <Company> warn when sharing outside of <Company>` is `checked`.

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Drive and Docs`
4. Select `Sharing Settings`
5. Select `Sharing Options`
6. Under `Sharing outside of <Company>`
7. Set `ON - Files owned by users in <Company> can be shared outside of <Company>. This applies to files in all shared drives as well.` to `checked`. Also, set the sub-setting `For files owned by users in <Company> warn when sharing outside of <Company>` to `checked`.
8. Select `Save`

## Default Value

`For files owned by users in <Company> warn when sharing outside of <Company>` is `checked`

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | x | x |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | x | x |
