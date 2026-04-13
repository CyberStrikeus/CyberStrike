---
name: cis-gworkspace-3.1.4.2.1
description: "Ensure Google Chat externally is restricted to allowed domains"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, google-chat, external-chat]
cis_id: "3.1.4.2.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Google Chat externally is restricted to allowed domains (Manual)

## Description

Control how users chat with people outside of your organization. If you allow your users to chat externally, you can also allow them to create and join spaces with people outside your organization.

## Rationale

Restricting external chat to only approved domains potentially limits the spread of company information.

## Impact

Users will not be able to chat with users in any external domain, only approved domains. This will require some admin-level approval and allowlist maintenance.

## Audit Procedure

### Using Google Workspace Admin Console

1. Log in to https://admin.google.com as an administrator
2. Select `Apps`
3. Select `Google Chat and classic Hangouts`
4. Select `External Chat Settings`
5. Select `Chat externally`
6. Verify `Allow users to send messages outside <company>` is **ON**
7. Verify `Only allow this for allowlisted domains` is **checked**

### Expected Result

`Allow users to send messages outside <company>` should be ON, and `Only allow this for allowlisted domains` should be checked.

## Remediation

### Using Google Workspace Admin Console

1. Log in to https://admin.google.com as an administrator
2. Select `Apps`
3. Select `Google Chat and classic Hangouts`
4. Select `External Chat Settings`
5. Select `Chat externally`
6. Set `Allow users to send messages outside <company>` to **ON**
7. Set `Only allow this for allowlisted domains` to **checked**
8. Select `Save`

## Default Value

- `Allow users to send messages outside <company>` is set to **ON**
- `Only allow this for allowlisted domains` is **unchecked**

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |

## Profile

Level 1
