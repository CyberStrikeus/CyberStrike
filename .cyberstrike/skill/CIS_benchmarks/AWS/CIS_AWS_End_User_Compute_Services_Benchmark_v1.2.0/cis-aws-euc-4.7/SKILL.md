---
name: cis-aws-euc-4.7
description: "Ensure publicly shareable links is not allowed in WorkDocs"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, workdocs, data-protection, public-sharing]
cis_id: "4.7"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: [CWE-732]
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure publicly shareable links is not allowed in WorkDocs (Manual)

## Profile Applicability

- Level 1

## Description

The organization should not allow publicly shareable links for WorkDocs.

## Rationale

If a user can create and send a publicly shareable links allowing a file to be viewed by people outside of the organization it could potentially lead to an security or information leak.

## Audit Procedure

Perform the steps to confirm publicly shareable links for WorkDocs is not allowed.

### Using WorkDocs Admin Control Panel

1. Log in to WorkDocs as an Administrator
2. Click **Security**
3. Under **public share settings**
4. Confirm that **No public sharing is selected**

If this is not selected choice refer to the remediation below.

### Using AWS Console

Not applicable - must be audited via WorkDocs Admin control panel.

## Expected Result

Public share settings are configured to disallow public sharing.

## Remediation

### Using WorkDocs Admin Control Panel

Perform the steps to set set publicly shareable links for WorkDocs to not allowed:

1. Log in to WorkDocs as an Administrator
2. Click **Security**
3. Under **public share settings**
4. Select **No public sharing** - Users cannot send view links to anyone outside the organization

### Using AWS CLI

Not applicable - must be configured via WorkDocs Admin control panel.

## Default Value

By default, publicly shareable links are disabled.

## References

1. https://docs.aws.amazon.com/workdocs/latest/adminguide/manage-sites.html
2. https://docs.aws.amazon.com/workdocs/latest/userguide/web_share_link.html

## CIS Controls

**v8:**
- 3.3 Configure Data Access Control Lists
  - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.

**v7:**
- 14.6 Protect Information through Access Control Lists
  - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

## Profile

Level 1
