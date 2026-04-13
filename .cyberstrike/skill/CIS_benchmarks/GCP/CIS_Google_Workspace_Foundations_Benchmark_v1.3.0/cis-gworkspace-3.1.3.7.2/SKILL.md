---
name: cis-gworkspace-3.1.3.7.2
description: "Ensure 'Send email over a secure TLS connection' Is Enabled"
category: cis-gworkspace
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gcp, google-workspace, gmail, tls, compliance]
cis_id: "3.1.3.7.2"
cis_benchmark: "CIS Google Workspace Foundations Benchmark v1.3.0"
tech_stack: [gcp, google-workspace]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure 'Send email over a secure TLS connection' Is Enabled (Manual)

## Description

The default is that Gmail always tries to send messages over a secure TLS connection. If the receiving server doesn't use TLS, Gmail still sends messages with TLS but the connection isn't secure.

This setting allows the option to require a CA-signed certificate, verify the hostname associated with the certificate, and test the TLS connection.

A padlock image will appear next to the recipient address if the message will be sent with TLS. The padlock shows only for accounts with a Google Workspace subscription that supports S/MIME encryption.

Google Workspace supports TLS versions 1.0, 1.1, 1.2, and 1.3.

## Rationale

Transport Layer Security (TLS) encrypts email messages for security and privacy and prevents unauthorized access of messages when they're sent over internet connections.

## Impact

This should not have an impact on the usage of Gmail.

## Audit Procedure

### Using Google Workspace Admin Console

1. Log in to https://admin.google.com as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Gmail`
5. Select `Compliance`
6. Under `Secure transport (TLS) compliance`, select `Configure`
7. Under `Email messages to affect` ensure `Inbound - all messages` and `Outbound - all messages` are **ON**

### Expected Result

Both `Inbound - all messages` and `Outbound - all messages` should be ON under Secure transport (TLS) compliance.

## Remediation

### Using Google Workspace Admin Console

1. Log in to https://admin.google.com as an administrator
2. Select `Apps`
3. Select `Google Workspace`
4. Select `Gmail`
5. Select `Compliance`
6. Select `Secure transport (TLS) compliance`
7. Select `Configure`
8. Set `Inbound - all messages` and `Outbound - all messages` to **checked**
9. Select `Save`

**Note:** Enabling the `Inbound - all messages` and `Outbound - all messages` configurations will also, by default, enable `Require CA-signed certificate when delivering outbound messages to the TLS-enabled domains specified above`. This is not a required configuration, but it is recommended.

## Default Value

This setting is not configured by default.

## References

1. https://support.google.com/a/answer/2520500

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit            |      | x    | x    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit |      | x    | x    |

## Profile

Level 1
