---
name: cis-aws-euc-4.6
description: "Ensure only specific users are allowed to invite external users"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, workdocs, access-control, external-sharing]
cis_id: "4.6"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: [CWE-284]
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure only specific users are allowed to invite external users (Manual)

## Profile Applicability

- Level 1

## Description

The organization should only allow administrators the ability to invite external users to the WorkDocs site.

## Rationale

If anyone can invite a user outside of the organization it could potentially lead to security or information leak.

## Audit Procedure

Perform the steps to confirm Only Administrators can invite new external users for WorkDocs.

### Using WorkDocs Admin Control Panel

1. Log in to WorkDocs as an Administrator
2. Click **Security**
3. Under **external invites**
4. Confirm that only:

**Only administrators can invite new external users**

If this is not set to "Only administrators can invite new external users" refer to the remediation below.

### Using AWS Console

Not applicable - must be audited via WorkDocs Admin control panel.

## Expected Result

External invite settings are configured so only administrators can invite external users.

## Remediation

### Using WorkDocs Admin Control Panel

Perform the steps to Set Only Administrators can invite new external users for WorkDocs:

1. Log in to WorkDocs as an Administrator
2. Click **Security**
3. Under **external invites**
4. Select:

**Only administrators can invite new external users**

- Only administrators can invite external users to use Amazon WorkDocs.

### Using AWS CLI

Not applicable - must be configured via WorkDocs Admin control panel.

## Default Value

By default, this is dependent on the policies assigned.

## References

1. https://docs.aws.amazon.com/workdocs/latest/adminguide/manage-sites.html

## CIS Controls

**v8:**

- 3.3 Configure Data Access Control Lists
  - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.

**v7:**

- 14.6 Protect Information through Access Control Lists
  - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

## Profile

Level 1
