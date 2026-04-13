---
name: cis-aws-euc-4.5
description: "Ensure new users can only be invited from allowed domains"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, workdocs, access-control, domain-restriction]
cis_id: "4.5"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: [CWE-284]
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure new users can only be invited from allowed domains (Manual)

## Profile Applicability

- Level 1

## Description

Users that are allowed access to shared files or folders in WorkDocs should be limited to specific domains.

## Rationale

To control who should be allowed to join your WorkDocs site, users should be limited on who they can invite sharing files or folders with new people from the specified domains.

## Audit Procedure

Perform the steps to confirm WorkDocs file and sharing folders is controlled by specified domains.

### Using WorkDocs Admin Control Panel

1. Log in to WorkDocs as an Administrator
2. Click **Security**
3. Under **Invite settings**
4. Confirm that only:

**Users can invite new people from a few specific domains by sharing files or folders with them**

5. Confirm the listed **Domains** is accurate

If the setting is not set to "Users can invite new people from a few specific domains by sharing files or folders with them" or the domains listed is not accurate refer to the remediation below.

### Using AWS Console

Not applicable - must be audited via WorkDocs Admin control panel.

## Expected Result

WorkDocs invite settings restrict user invitations to approved domains only.

## Remediation

### Using WorkDocs Admin Control Panel

Perform the steps to set WorkDocs file and sharing folders to be controlled by specified domains:

1. Log in to WorkDocs as an Administrator
2. Click **Security**
3. Under **Invite settings**
4. Select:

**Users can invite new people from a few specific domains by sharing files or folders with them**

5. Add in or edit the listed allowed Domains

### Using AWS CLI

Not applicable - must be configured via WorkDocs Admin control panel.

## Default Value

By default, this setting is disabled.

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
