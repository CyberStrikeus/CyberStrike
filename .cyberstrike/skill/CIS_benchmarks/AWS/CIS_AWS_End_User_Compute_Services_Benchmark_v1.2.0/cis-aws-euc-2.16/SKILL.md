---
name: cis-aws-euc-2.16
description: "Ensure FIPS Endpoint encryption is enabled for WorkSpaces"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, workspaces, encryption, fips, compliance]
cis_id: "2.16"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure FIPS Endpoint encryption is enabled for WorkSpaces (Manual)

## Description

To meet a high level of security and comply with different compliance standards, you must use Federal Information Processing Standards (FIPS) endpoint encryption at the directory level with WorkSpaces.

## Rationale

You must also use an AWS Region that is authorized for the same compliance standard that you are trying to achieve.

## Impact

None

## Audit Procedure

### Using AWS Console

Perform the steps below to determine if FIPS endpoint encryption is enabled.

1. Log in to the WorkSpaces console at https://console.aws.amazon.com/workspaces/
2. In the left pane, click Directories.
3. Select the directory id link.
4. Scroll to the Endpoint encryption section.
5. Endpoint Encryption should read:
   - FIPS 140-2 Validated Mode.

If Endpoint Encryption is not listed as FIPS 140-2 Validated Mode refer to the remediation procedure below.

### Expected Result

FIPS 140-2 endpoint encryption is enabled for the WorkSpaces directory.

## Remediation

### Using AWS Console

Perform the steps below to enable FIPS endpoint encryption at the directory level.

1. Log in to the WorkSpaces console at https://console.aws.amazon.com/workspaces/
2. In the left pane, click Directories.
3. Verify that the directory does not have any existing WorkSpaces associated with it.
4. Select the directory id link.
5. Click Actions, Update Details.
6. Scroll to the Endpoint encryption section and select Edit
7. For Endpoint Encryption, choose FIPS 140-2 Validated Mode.
8. Click Save.

You can now create WorkSpaces from this directory that utilize FIPS endpoint encryption modules.

## Default Value

By default, FIPS is disabled. TLS 1.2 is the default encryption standard for AWS Workspaces.

## References

1. https://docs.aws.amazon.com/workspaces/latest/adminguide/fips-encryption.html
2. https://aws.amazon.com/compliance/services-in-scope/
3. https://docs.aws.amazon.com/workspaces-web/latest/adminguide/fips-endpoints.html

## CIS Controls

**Controls Version v8:**
- 3.11 Encrypt Sensitive Data at Rest

**Controls Version v7:**
- 14.8 Encrypt Sensitive Information at Rest

## Profile

Level 2
