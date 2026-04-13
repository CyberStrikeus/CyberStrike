---
name: cis-gworkspace-3.1.3.2.3
description: "Ensure the DMARC record is configured for all mail enabled domains"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, gmail, dmarc, email-security]
cis_id: "3.1.3.2.3"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: [cis-gworkspace-3.1.3.2.1, cis-gworkspace-3.1.3.2.2]
prerequisites: []
severity_boost: {}
---

# 3.1.3.2.3 Ensure the DMARC record is configured for all mail enabled domains

## Overview

| Property                  | Value                      |
| ------------------------- | -------------------------- |
| **CIS ID**                | 3.1.3.2.3                  |
| **Level**                 | L1                         |
| **Profile Applicability** | Enterprise Level 1         |
| **Assessment Type**       | Manual                     |
| **Section**               | Gmail > Authenticate email |

## Description

For all email domains configured in Google Workspace, a corresponding Domain-Based Message Authentication, Reporting and Conformance (DMARC) record should be created.

**NOTE:** There are a number of ways DMARC can be configured, this document presents a most basic method. For more information on setting up DMARC for Google Workspace please refer to the Google documentation.

## Rationale

DMARC works with Sender Policy Framework (SPF) and Domain Keys Identified Mail (DKIM) to authenticate mail senders and ensure that destination email systems trust messages sent from your domain. Spammers can spoof your domain or organization to send fake messages that impersonate your organization. DMARC tells receiving mail servers what to do when they get a message that appears to be from your organization, but doesn't pass authentication checks, or doesn't meet the authentication requirements in your DMARC policy record. Messages that aren't authenticated might be impersonating your organization, or might be sent from unauthorized servers.

## Impact

There should be minimal impact of setting up DMARC records however, organizations should ensure proper DMARC record setup as email could be flagged as spam if DMARC is not set up appropriately.

## Default Value

None

## Audit

Check the DNS records for each domain.

1. Use a Domain Name System (DNS) lookup tool to review the current configuration for your domain (DNS Records). This information can be discovered in a variety of ways:
   - Reviewing the DNS Record information at your domain registrar (GoDaddy, etc.)
   - Using an OS based `nslookup` tool on your workstation OS
   - **Preferred**: Using Google **Dig** tool available from the Google Admin Toolbox site
2. Using the chosen tool, enter your email domain name (ex. domain1.com)
3. In the results displayed, ensure that a TXT Record with the value of `v=DMARC1; p=none; rua=mailto:<report@domain1.com>` exists. This designates Google Gmail as an authorized sender.

**NOTE:** The **p=none** sets DMARC to non-enforcing. This is a relaxed DMARC policy that lets you start getting reports without risking messages from your domain being rejected or marked as spam by receiving servers. Start with a none policy that only monitors email flow, and then eventually change to a policy that rejects all unauthenticated messages (`p=reject`).

**NOTE:** The **rua=mailto:** entry is optional but setting it to a valid email address is recommended. RUA reports provide a comprehensive view of all of a domain's traffic. At a minimum, organizations should configure their DMARC record to receive RUA reports.

## Remediation

Configure the DNS record for each domain.

1. If all email in your domain is sent from and received by Google Gmail, add the following TXT record for the domain:

```
v=DMARC1; p=none; rua=mailto:<report@domain1.com>
```

**NOTE:** This will likely need to be configured at your domain registrar (Godaddy, etc.).

## CIS Controls

| Controls Version | Control                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 9.5 Implement DMARC                                       |      | x    | x    |
| v7               | 7.8 Implement DMARC and Enable Receiver-Side Verification |      | x    | x    |
