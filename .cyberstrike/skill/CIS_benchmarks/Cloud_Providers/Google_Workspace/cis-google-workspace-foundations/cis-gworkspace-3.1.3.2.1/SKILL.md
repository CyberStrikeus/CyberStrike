---
name: cis-gworkspace-3.1.3.2.1
description: "Ensure that DKIM is enabled for all mail enabled domains"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, gmail, dkim, email-security]
cis_id: "3.1.3.2.1"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: [cis-gworkspace-3.1.3.2.2, cis-gworkspace-3.1.3.2.3]
prerequisites: []
severity_boost: {}
---

# 3.1.3.2.1 Ensure that DKIM is enabled for all mail enabled domains

## Overview

| Property                  | Value                      |
| ------------------------- | -------------------------- |
| **CIS ID**                | 3.1.3.2.1                  |
| **Level**                 | L1                         |
| **Profile Applicability** | Enterprise Level 1         |
| **Assessment Type**       | Manual                     |
| **Section**               | Gmail > Authenticate email |

## Description

DKIM adds an encrypted signature to the header of all outgoing messages. Email servers that get signed messages use DKIM to decrypt the message header, and verify the message was not changed after it was sent.

## Rationale

Spoofing is a common unauthorized use of email, so some email servers require DKIM to prevent email spoofing.

## Impact

There should be no impact of setting up DKIM however, organizations should ensure appropriate setup to ensure continuous mail-flow.

## Default Value

None

## Audit

To verify this setting via the Google Workspace Admin Console:

1. Log in to [https://admin.google.com](https://admin.google.com) as an administrator
2. Select **Apps**
3. Select **Google Workspace**
4. Select **Gmail**
5. Under `Authenticate email`, ensure a DKIM record exists for each mail enabled domain

## Remediation

To configure this setting via the Google Workspace Admin Console:

1. Log in to [https://admin.google.com](https://admin.google.com) as an administrator
2. Select **Apps**
3. Select **Google Workspace**
4. Select **Gmail**
5. Under `Authenticate email`, select `Generate new record`
6. Under `Select DKIM key bit length`, select the appropriate key bit length (2048 is recommended if supported)
7. Under `Prefix selector (optional)`, enter the appropriate prefix selector
8. Use the text at TXT record value to update the DNS record at your domain host
9. Select `Start Authentication`

## CIS Controls

| Controls Version | Control                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 9.5 Implement DMARC                                       |      | x    | x    |
| v7               | 7.8 Implement DMARC and Enable Receiver-Side Verification |      | x    | x    |
