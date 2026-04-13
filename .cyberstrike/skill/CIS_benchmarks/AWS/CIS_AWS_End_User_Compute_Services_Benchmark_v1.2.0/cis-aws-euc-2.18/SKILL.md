---
name: cis-aws-euc-2.18
description: "Ensure Radius server is using the recommended security protocol"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, workspaces, radius, mfa, authentication]
cis_id: "2.18"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Radius server is using the recommended security protocol (Automated)

## Description

The authentication protocol between the Microsoft AD DCs and the RADIUS server supported are PAP, CHAP, MS-CHAPv1, and MS-CHAPv2.

## Rationale

MS-CHAPv2 provides the strongest security of the options supported.

## Impact

None

## Audit Procedure

### Using AWS Console - For AWS Managed AD based environments

Perform the steps to check multi-factor authentication using the radius server protocol is set to MS-CHAP v2.

1. Log in to the Directory Service console at https://console.aws.amazon.com/directoryservicev2
2. In the left pane select Directories.
3. Choose the directory ID link for your AWS Managed Microsoft AD directory.
4. On the Directory details page, select the Networking & security tab.
5. In the Multi-factor authentication section, confirm that the Protocol is set to MS-CHAPv2.

### Using AWS Console - For directory connector / self-managed AD environments

1. Log in to the AWS Workspaces console at https://console.aws.amazon.com/workspaces
2. In the left pane select Directories.
3. Select the directory ID link for your AWS Managed Microsoft AD directory.
4. On the Directories page, scroll to the Multi-factor authentication section and select Edit.
5. In the Multi-factor authentication section confirm that, in the Protocol field MS-CHAPv2 is selected from the dropdown list.

If it is not set to MS-CHAPv2 refer to the remediation steps below.

### Expected Result

The RADIUS server protocol is configured to use MS-CHAPv2 for multi-factor authentication.

## Remediation

### Using AWS Console - For AWS Managed AD based environments

Perform the steps below to set the protocol to MS-CHAPv2 for multi-factor authentication.

1. Log in to the Directory Service console at https://console.aws.amazon.com/directoryservicev2
2. In the left pane select Directories.
3. On the Directory details page, select the Networking & security tab.
4. In the Multi-factor authentication section, choose Actions, and then choose Edit.
5. On the Enable multi-factor authentication (MFA) page change the following value:
6. Protocol - MS-CHAPv2
7. Click Save.

### Using AWS Console - For directory connector / self-managed AD environments

1. Log in to the AWS Workspaces console at https://console.aws.amazon.com/workspaces
2. In the left pane select Directories.
3. Select the directory ID link for your AWS Managed Microsoft AD directory.
4. On the Directories page, scroll to the Multi-factor authentication section and select Edit.
5. In the Multi-factor authentication section modify the protocol using the dropdown menu to be MS-CHAPv2 from the currently selected option.
6. Click Save once settings are as desired.

## Default Value

By default, this is dependent on your RADIUS server.

## References

1. https://aws.amazon.com/blogs/security/how-to-enable-multi-factor-authentication-for-amazon-workspaces-and-amazon-quicksight-by-using-microsoft-ad-and-on-premises-credentials/
2. https://docs.aws.amazon.com/directoryservice/latest/admin-guide/ms_ad_mfa.html

## CIS Controls

**Controls Version v8:**

- 5.6 Centralize Account Management

**Controls Version v7:**

- 16.2 Configure Centralized Point of Authentication

## Profile

Level 2
