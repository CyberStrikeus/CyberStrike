---
name: cis-gworkspace-3.1.3.5.4
description: "Ensure external recipient warnings are enabled"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, gmail, forwarding]
cis_id: "3.1.3.5.4"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure external recipient warnings are enabled (Manual)

## Description

Gmail adds an image or colored border to external addresses.

## Rationale

As an admin for your organization, you can turn alerts on or off for messages that include external recipients (people with email addresses outside of your organization). These alerts help people avoid unintentional replies, and remind them to treat external messages with caution.

## Impact

When this setting is on, Gmail shows warnings (colored border) when:

- An email thread includes external recipients (not available on iOS).
- Replying to a message from an external recipient.
- Composing a new message to an external recipient (not available on iOS).

Gmail doesn't show a warning if the external recipient is in your organization's Directory, personal Contacts, or other Contacts. Warnings aren't displayed for secondary domain or domain alias addresses.

## Audit Procedure

### Using Google Workspace Admin Console

1. Log in to https://admin.google.com as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Gmail`
5. Select `End User Access`
6. Under `Warn for external recipients`, ensure `Highlight any external recipients in a conversation. Warn users before they reply to email with external recipients who aren't in their contacts.` is **ON**

### Expected Result

`Highlight any external recipients in a conversation. Warn users before they reply to email with external recipients who aren't in their contacts.` should be ON.

## Remediation

### Using Google Workspace Admin Console

1. Log in to https://admin.google.com as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Gmail`
5. Select `End User Access`
6. Select `Warn for external recipients`
7. Set `Highlight any external recipients in a conversation. Warn users before they reply to email with external recipients who aren't in their contacts.` to **checked**
8. Select `Save`

## Default Value

`Highlight any external recipients in a conversation. Warn users before they reply to email with external recipients who aren't in their contacts.` is **ON**

## CIS Controls

This control does not have explicit CIS Controls mappings in the PDF.

## Profile

Level 1
