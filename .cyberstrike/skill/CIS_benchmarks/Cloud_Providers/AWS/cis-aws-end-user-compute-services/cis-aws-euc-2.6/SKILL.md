---
name: cis-aws-euc-2.6
description: "Ensure Web Access to Workspaces is Disabled"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, workspaces, web-access, access-control]
cis_id: "2.6"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-euc-2.7]
prerequisites: []
severity_boost: {}
---

# Ensure Web Access to Workspaces is Disabled (Automated)

## Profile Applicability

- Level 1

## Description

WorkSpaces access should be restricted to trusted operating systems and clients.

## Rationale

WorkSpaces access is supported from a variety of clients and operating systems, including HTML5 based browsers. Disabling Web Access prevents access to the Workspace from HTML5 based browsers, ensuring access can only occur from known operating systems.

## Impact

None specified in the benchmark.

## Audit Procedure

### Using AWS Console

Perform the following steps to confirm that Web Access is disabled:

1. Log in to the WorkSpaces console at https://console.aws.amazon.com/workspaces/
2. In the left pane, click **Directories**
3. Select the directory id link you wish to view
4. Scroll to the **Other platforms** section
5. Confirm that **Web Access** is denied

If everything is not configured as above refer to the remediation below.

## Remediation

### Using AWS Console

Perform the following steps to disable Web Access:

1. Log in to the WorkSpaces console at https://console.aws.amazon.com/workspaces/
2. In the left pane, click **Directories**
3. Select the directory id link
4. Scroll to the **Other platforms** section
5. Uncheck **Web Access**
6. Click **Save**

## Default Value

By default, web access is disabled.

## References

1. https://docs.aws.amazon.com/workspaces/latest/adminguide/web-access.html

## CIS Controls

**v8:**

- 13.5 Manage Access Control for Remote Assets
  - Manage access control for assets remotely connecting to enterprise resources. Determine amount of access to enterprise resources based on: up-to-date anti-malware software installed, configuration compliance with the enterprise's secure configuration process, and ensuring the operating system and applications are up-to-date.

**v7:**

- 12.12 Manage All Devices Remotely Logging into Internal Network
  - Scan all enterprise devices remotely logging into the organization's network prior to accessing the network to ensure that each of the organization's security policies has been enforced in the same manner as local network devices.
