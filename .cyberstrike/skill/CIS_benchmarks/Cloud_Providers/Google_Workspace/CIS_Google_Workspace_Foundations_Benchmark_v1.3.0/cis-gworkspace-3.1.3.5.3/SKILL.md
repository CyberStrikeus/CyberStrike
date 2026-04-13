---
name: cis-gworkspace-3.1.3.5.3
description: "Ensure per-user outbound gateways is disabled"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, gmail, forwarding]
cis_id: "3.1.3.5.3"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure per-user outbound gateways is disabled (Manual)

## Description

A per-user outbound gateway is a mail server, other than the Google Workspace mail servers, that delivers outgoing mail for a user in your domain.

## Rationale

Mail sent via external SMTP will circumvent your outbound gateway.

## Impact

Care should be taken before implementation to ensure there is no business need for mail sent via external SMTP gateway.

## Audit Procedure

### Using Google Workspace Admin Console

1. Log in to https://admin.google.com as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Gmail`
5. Under `End User Access` - `Allow per-user outbound gateways`, ensure `Allow users to send mail through an external SMTP server when configuring a "from" address hosted outside your email domain` is **unchecked**

### Expected Result

`Allow users to send mail through an external SMTP server when configuring a "from" address hosted outside your email domain` should be unchecked.

## Remediation

### Using Google Workspace Admin Console

1. Log in to https://admin.google.com as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Gmail`
5. Under `End User Access` - `Allow per-user outbound gateways`, set `Allow users to send mail through an external SMTP server when configuring a "from" address hosted outside your email domain` to **unchecked**
6. Select `Save`

## Default Value

`Allow users to send mail through an external SMTP server when configuring a "from" address hosted outside your email domain` is **unchecked**

## CIS Controls

This control does not have explicit CIS Controls mappings in the PDF.

## Profile

Level 1
