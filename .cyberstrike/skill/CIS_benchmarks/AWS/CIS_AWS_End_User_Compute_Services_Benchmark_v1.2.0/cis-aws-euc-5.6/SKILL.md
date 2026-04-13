---
name: cis-aws-euc-5.6
description: "Ensure internet access is granted and managed through your VPC"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, appstream, network-security, vpc]
cis_id: "5.6"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: [CWE-668]
chains_with: [cis-aws-euc-5.1]
prerequisites: [cis-aws-euc-5.1]
severity_boost: {}
---

# Ensure internet access is granted and managed through your VPC (Automated)

## Profile Applicability

- Level 1

## Description

Default Internet Access from your fleet streaming instances should remain unchecked.

## Rationale

When Default Internet Access is enabled, AppStream 2.0 uses the internet gateway in the VPC public subnet to connect to the public internet. The streaming instances are then assigned public IP addresses that are directly accessible from the internet.

Internet Access from fleet streaming instances should be controlled using a NAT gateway in the VPC. When Default Internet Access is not enabled, streaming instances are assigned a private IP address that are not directly accessible from the internet.

## Impact

None - this is a security best practice.

## Audit Procedure

Perform the following steps to view the Fleet settings in AppStream.

### Using AWS Console

1. Log in to the AppStream 2.0 console at `https://console.aws.amazon.com/appstream2`
2. In the left pane click on **Fleets**
3. Select the link for the fleet name you wish to view
4. On the **Network details** section confirm that Default Internet Access is set to **Disabled**

If Default internet access is not set to disabled refer to the remediation below.

### Using AWS CLI

Not applicable - must be audited via Console.

## Expected Result

Default Internet Access is disabled for the fleet.

## Remediation

### Using AWS Console

Perform the following steps to view the Fleet settings in AppStream:

1. Log in to the AppStream 2.0 console at `https://console.aws.amazon.com/appstream2`
2. In the left pane click on **Fleets**
3. Select the link for the fleet name you wish to edit
4. Click **Actions**, **Stop**
5. Scroll to the **Network details** section and click **Edit**
6. Deselect **Default Internet Access**
7. Click **Save changes**

### Using AWS CLI

Not applicable - must be configured via Console.

## Default Value

By default, internet access is not enabled; the box is "unchecked" in the management console.

## References

1. https://docs.aws.amazon.com/appstream2/latest/developerguide/set-up-stacks-fleets.html

## CIS Controls

**v8:**
- 3.3 Configure Data Access Control Lists
  - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.

**v7:**
- 14.6 Protect Information through Access Control Lists
  - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

## Profile

Level 1
