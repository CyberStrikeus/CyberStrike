---
name: cis-gworkspace-3.1.2.1.1.3
description: "Ensure document sharing is being controlled by domain with allowlists"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, drive, docs, sharing, file-access]
cis_id: "3.1.2.1.1.3"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.2.1.1.3 Ensure document sharing is being controlled by domain with allowlists

## Level

L2

## Profile Applicability

- Enterprise Level 2

## Type

Manual

## Description

You should control sharing of documents to external domains by either blocking domains or only allowing sharing with specific named domains.

## Rationale

Attackers will often attempt to expose sensitive information to external entities through sharing, and restricting the domains that your users can share documents with will reduce that surface area.

## Impact

Enabling this feature will prevent users from sharing documents with domains outside of the organization unless allowed.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Drive and Docs`
5. Under `Sharing settings`, select `Sharing options`
6. Under `Sharing outside of <Company>`, ensure `ALLOWLISTED DOMAINS - Files owned by users in <Company> can be shared with Google Accounts in compatible allowlisted domains.` is `selected`
7. Ensure `Warn when files owned by users or shared drives in <Company> are shared with users in allowlisted domains` is `checked`

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Drive and Docs`
5. Under `Sharing settings`, select `Sharing options`
6. Under `Sharing outside of <Company>`, select `ALLOWLISTED DOMAINS - Files owned by users in <Company> can be shared with Google Accounts in compatible allowlisted domains.`
7. Set `Warn when files owned by users or shared drives in <Company> are shared with users in allowlisted domains` to `checked`
8. Select `Save`

## Default Value

`Sharing outside of <Company>` is `ON - Files owned by users in <Company> can be shared outside of <Company>. This applies to files in all shared drives as well.`

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |
