---
name: cis-aws-compute-16.1
description: "Ensure communications between your applications and clients is encrypted"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, simspace-weaver, encryption, tls, communication]
cis_id: "16.1"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 16.1 Ensure communications between your applications and clients is encrypted (Manual)

## Description

SimSpace Weaver doesn't manage communications between your apps and the clients.

## Rationale

Be sure to implement some form of authentication and encryption for all client sessions while using SimSpace Weaver.

## Impact

N/A

## Audit Procedure

### Using AWS Console

There is no setting for encryption setup for your clients and applications within SimSpace Weaver service. For this audit you have to confirm that the communication is configured in the app and the client with encryption to protect that traffic.

### Using AWS CLI

N/A - This control is manual. There are no AWS CLI commands specific to SimSpace Weaver encryption settings as the encryption must be configured at the application/client level.

## Expected Result

Communications between applications and clients running inside SimSpace Weaver are configured with encryption (e.g., TLS) to protect traffic.

## Remediation

### Using AWS Console

Confirm that the communication you have configured between your application and clients that run inside of SimSpace Weaver are encrypted.

### Using AWS CLI

N/A - Remediation is application-level and not managed through AWS CLI.

## Default Value

SimSpace Weaver does not manage or enforce encryption between applications and clients by default. This is the responsibility of the application developer.

## References

1. https://docs.aws.amazon.com/simspaceweaver/latest/userguide/security_best-practices.html

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit            |      | X    | X    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit |      | X    | X    |

## Profile

Level 1 | Manual
