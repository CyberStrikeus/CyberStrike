---
name: cis-aws-euc-4.3
description: "Ensure Workdocs access is limited to a range of allowable IP addresses"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, workdocs, network-security, ip-filtering]
cis_id: "4.3"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: [CWE-284]
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Workdocs access is limited to a range of allowable IP addresses (Manual)

## Profile Applicability

- Level 1

## Description

Access to WorkDocs can be limited to an allowed range of IP addresses.

## Rationale

Using IP address allow lists, you define and permit access to your WorkDocs site from trusted networks.

## Impact

IP Lists currently only work for IPv4 addresses and denying access through an IP list is not supported.

## Audit Procedure

Perform these steps to review the list of IP addresses allowed to access WorkDocs.

### Using AWS Console

1. Log into the AWS console
2. Navigate to WorkDocs or go to WorkDocs Console at `https://console.aws.amazon.com/zocalo/`
3. Under My Account, choose **Open admin control panel**
4. For IP Allow List, choose **Change**
5. Review the IP address ranges and any single IP addresses
6. Click **Cancel**

If the IP address ranges do not match trusted networks refer to the remediation below to create or edit the IP Allow list.

### Using AWS CLI

Not applicable - must be audited via Console.

## Expected Result

IP Allow List is configured with trusted IP ranges only.

## Remediation

### Using AWS Console

Perform the steps below to create or edit the IP Allow list for WorkDocs:

1. Log into the AWS console
2. Navigate to WorkDocs or go to WorkDocs Console at `https://console.aws.amazon.com/zocalo/`
3. Under My Account, choose **Open admin control panel**
4. For IP Allow List, choose **Change**
5. For Enter CIDR value, enter the IP address ranges to **allowlist**. To allow access from a single IP address, specify /32 as the CIDR prefix
6. Click **Add**
7. Click **Save Changes**

### Using AWS CLI

Not applicable - must be configured via Console.

## Default Value

By default, no IP addresses are allowed.

## References

1. https://docs.aws.amazon.com/workdocs/latest/adminguide/prereqs.html
2. https://aws.amazon.com/about-aws/whats-new/2018/10/amazon-workdocs-control-ip-address-access/
3. https://docs.aws.amazon.com/workdocs/latest/adminguide/workdocs-ag.pdf
4. https://docs.aws.amazon.com/workdocs/latest/adminguide/manage-sites.html

## CIS Controls

**v8:**

- 3.3 Configure Data Access Control Lists
  - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.

**v7:**

- 14.6 Protect Information through Access Control Lists
  - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

## Profile

Level 1
