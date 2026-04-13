---
name: cis-gworkspace-3.1.3.5.1
description: "Ensure POP and IMAP access is disabled for all users"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, gmail, pop, imap]
cis_id: "3.1.3.5.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure POP and IMAP access is disabled for all users (Manual)

## Description

POP and IMAP may allow users to access Gmail using legacy or unapproved email clients that do not support modern authentication mechanisms, such as multifactor authentication.

## Rationale

Disabling POP and IMAP prevents use of legacy and unapproved email clients with weaker authentication mechanisms that would increase the risk of email account credential compromise.

## Impact

If you have Apple iOS or Android device users in your organization and you turn IMAP off, let them know that they're no longer syncing Google Workspace mail to the iOS or Android Mail app. They might not get a notification on their device. Additionally, new users can't manually add the Google Account they use for work or school to the device.

If your Google Workspace users want to use desktop clients, such as Microsoft Outlook and Apple Mail, to access their Google Workspace mail, you need to enable POP or IMAP access in the Google Admin console. You can enable access for everyone in your organization or only for users in specific organizational units.

## Audit Procedure

### Using Google Workspace Admin Console

1. Log in to https://admin.google.com as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Gmail`
5. Under `End User Access` - `POP and IMAP Access`
6. Ensure `Enable IMAP access for all users` is **unchecked**
7. Ensure `Enable POP access for all users` is **unchecked**

### Expected Result

Both `Enable IMAP access for all users` and `Enable POP access for all users` should be unchecked.

## Remediation

### Using Google Workspace Admin Console

1. Log in to https://admin.google.com as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Gmail`
5. Under `End User Access` - `POP and IMAP Access`
6. Set `Enable IMAP access for all users` to **unchecked**
7. Set `Enable POP access for all users` to **unchecked**
8. Select `Save`

## Default Value

- `Enable IMAP access for all users` is **checked**
- `Enable POP access for all users` is **checked**

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running              |      | x    | x    |

## Profile

Level 2
