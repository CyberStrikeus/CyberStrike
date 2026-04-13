---
name: cis-gworkspace-3.1.2.1.1.2
description: "Ensure users cannot publish files to the web or make visible to the world as public or unlisted"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, drive, docs, sharing, file-access]
cis_id: "3.1.2.1.1.2"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.2.1.1.2 Ensure users cannot publish files to the web or make visible to the world as public or unlisted

## Level

L1

## Profile Applicability

- Enterprise Level 1

## Type

Manual

## Description

You should control the publishing of documents to the web or making them visable to the world as public or unlisted.

## Rationale

Attackers will often attempt to expose sensitive information to external entities through sharing, and restricting the methods that your users can share documents with will reduce that surface area.

This setting is only applicable if `ON - Files owned by users in <Company> can be shared outside of <Company>. This applies to files in all shared drives as well` is `selected`, but should be configured as described below to prevent unintentional document publishing.

## Impact

Enabling this feature will prevent users from publishing documents on the web or making them visible to the world as public or unlisted files.

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Drive and Docs`
5. Under `Sharing settings`, select `Sharing options`
6. Under `Sharing outside of <Company>` - `ON - Files owned by users in <Company> can be shared outside of <Company>. This applies to files in all shared drives as well`, ensure `When sharing outside of <Company> is allowed, users in <Company> can make files and published web content visible to anyone with the link` is `unchecked`

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to `https://admin.google.com` as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Drive and Docs`
5. Under `Sharing settings`, select `Sharing options`
6. Under `Sharing outside of <Company>` - `ON - Files owned by users in <Company> can be shared outside of <Company>. This applies to files in all shared drives as well`, set `When sharing outside of <Company> is allowed, users in <Company> can make files and published web content visible to anyone with the link` to `unchecked`
7. Select `Save`

## Default Value

`When sharing outside of <Company> is allowed, users in <Company> can make files and published web content visible to anyone with the link` is `Checked`

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |
