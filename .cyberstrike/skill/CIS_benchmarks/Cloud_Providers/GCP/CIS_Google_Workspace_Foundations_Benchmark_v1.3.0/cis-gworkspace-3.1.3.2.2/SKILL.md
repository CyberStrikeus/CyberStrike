---
name: cis-gworkspace-3.1.3.2.2
description: "Ensure the SPF record is configured for all mail enabled domains"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, gmail, spf, email-security]
cis_id: "3.1.3.2.2"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: [cis-gworkspace-3.1.3.2.1, cis-gworkspace-3.1.3.2.3]
prerequisites: []
severity_boost: {}
---

# 3.1.3.2.2 Ensure the SPF record is configured for all mail enabled domains

## Overview

| Property                  | Value                      |
| ------------------------- | -------------------------- |
| **CIS ID**                | 3.1.3.2.2                  |
| **Level**                 | L1                         |
| **Profile Applicability** | Enterprise Level 1         |
| **Assessment Type**       | Manual                     |
| **Section**               | Gmail > Authenticate email |

## Description

For all the email domains configured in Google Workspace, a corresponding Sender Policy Framework (SPF) record should be created.

**NOTE:** There are a number of ways SPF can be configured, this document presents a most basic method. For more information on setting up SPF for Google Workspace please refer to the Google documentation.

## Rationale

SPF records allow Gmail and other mail systems to know where messages from your domains are allowed to originate. This information can be used by that system to determine how to treat the message based on if it is being spoofed or is valid.

## Impact

There should be minimal impact of setting up SPF records however, organizations should ensure proper SPF record setup as email could be flagged as spam if SPF is not set up appropriately.

## Default Value

None

## Audit

Check the DNS records for each domain.

1. Use a Domain Name System (DNS) lookup tool to review the current configuration for your domain (DNS Records). This information can be discovered in a variety of ways:
   - Reviewing the DNS Record information at your domain registrar (GoDaddy, etc.)
   - Using an OS based `nslookup` tool on your workstation OS
   - Using Google **Dig** tool available from the Google Admin Toolbox site
2. Using the chosen tool, enter your email domain name (ex. domain1.com)
3. In the results displayed, ensure that a TXT Record with the value of `v=spf1 include:_spf.google.com ~all` exists and designates Google Gmail as an authorized sender.

## Remediation

Configure the DNS record for each domain.

- If all email in your domain is sent from and received by Google Gmail, add the following TXT record for each domain:

```
v=spf1 include:_spf.google.com ~all
```

**NOTE:** This will likely need to be configured at your domain registrar (Godaddy, etc.).

## CIS Controls

| Controls Version | Control                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 9.5 Implement DMARC                                       |      | x    | x    |
| v7               | 7.8 Implement DMARC and Enable Receiver-Side Verification |      | x    | x    |
