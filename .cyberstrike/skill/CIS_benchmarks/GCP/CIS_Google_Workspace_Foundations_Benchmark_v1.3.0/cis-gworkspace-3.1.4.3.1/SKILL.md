---
name: cis-gworkspace-3.1.4.3.1
description: "Ensure external spaces in Google Chat and Hangouts are restricted"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, google-chat, external-chat]
cis_id: "3.1.4.3.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure external spaces in Google Chat and Hangouts are restricted (Manual)

## Description

Control whether users can create or join spaces within your organization that include external people outside of your organization.

## Rationale

Restricting external spaces to only approved domains potentially limits the spread of company information.

## Impact

Users with this setting turned off or who have editions that don't support external spaces can't create these spaces, but they can join existing spaces with external people.

## Audit Procedure

### Using Google Workspace Admin Console

1. Log in to https://admin.google.com as an administrator
2. Select `Apps`
3. Select `Google Chat and classic Hangouts`
4. Select `External Spaces`
5. Under `Setting`, verify `Allow users at <domain> to create and join spaces with people outside their organization` is **ON**
6. Verify `Only allow users to add people from allowlisted domains` is **checked**

### Expected Result

`Allow users at <domain> to create and join spaces with people outside their organization` should be ON, and `Only allow users to add people from allowlisted domains` should be checked.

## Remediation

### Using Google Workspace Admin Console

1. Log in to https://admin.google.com as an administrator
2. Select `Apps`
3. Select `Google Chat and classic Hangouts`
4. Select `External Spaces`
5. Under `Setting`, set `Allow users at <domain> to create and join spaces with people outside their organization` to **ON**
6. Set `Only allow users to add people from allowlisted domains` to **checked**
7. Select `Save`

## Default Value

- `Allow users at <company> to create and join spaces with people outside their organization` is **ON**
- `Only allow users to add people from allowlisted domains` is **unchecked**

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |

## Profile

Level 1
