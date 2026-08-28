---
name: cis-gworkspace-3.1.3.7.1
description: "Ensure comprehensive mail storage is enabled"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, gmail, compliance, mail-storage]
cis_id: "3.1.3.7.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure comprehensive mail storage is enabled (Manual)

## Description

Comprehensive mail storage ensures messages sent by other core services appear in users' sent folders and are therefore accessible to Vault.

## Rationale

As an administrator, you can ensure that a copy of all sent or received messages in your domain--including messages sent or received by non-Gmail mailboxes--is stored in the associated users' Gmail mailboxes.

## Impact

There are some important considerations to carefully review before enabling comprehensive mail storage:

- You should not enable comprehensive mail storage if you have compliance routing rules that change the recipient (and don't want the original recipient to receive a copy of the email).
- When you have the SMTP Relay service enabled, user mailboxes will keep a copy of the message in the sent folder (for example, when sending mail from a scanner) if comprehensive mail storage is enabled. This might cause accounts to exceed storage limits if your account's edition has storage limits.
- You should enable comprehensive mail storage if you only use Gmail for the Vault feature and forward email to your on-premise mail server or other email provider.

## Audit Procedure

### Using Google Workspace Admin Console

1. Log in to https://admin.google.com as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Gmail`
5. Select `Compliance`
6. Under `Comprehensive mail storage`, ensure `Ensure that a copy of all sent and received mail is stored in associated users' mailboxes` is **ON**

### Expected Result

`Ensure that a copy of all sent and received mail is stored in associated users' mailboxes` should be ON.

## Remediation

### Using Google Workspace Admin Console

1. Log in to https://admin.google.com as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Gmail`
5. Select `Compliance`
6. Select `Comprehensive mail storage`
7. Set `Ensure that a copy of all sent and received mail is stored in associated users' mailboxes` to **checked**
8. Select `Save`

## Default Value

`Copy of all sent and received mail is stored in associated users' mailboxes` is **OFF**

## CIS Controls

This control does not have explicit CIS Controls mappings in the PDF.

## Profile

Level 1
