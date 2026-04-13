---
name: cis-aws-euc-2.2
description: "Ensure MFA is enabled for WorkSpaces users"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, workspaces, mfa, authentication, radius]
cis_id: "2.2"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-euc-2.1]
prerequisites: []
severity_boost: {}
---

# Ensure MFA is enabled for WorkSpaces users (Manual)

## Profile Applicability
- Level 2

## Description
Multi-Factor Authentication (MFA) adds an extra layer of authentication assurance beyond traditional username and password. With MFA enabled, when a user signs in to Amazon WorkSpaces, they will be prompted for their user name and password as well as for an authentication code from their physical or virtual MFA token. It is recommended that MFA be enabled for all accounts that utilize WorkSpaces.

## Rationale
Enabling MFA provides increased security to a username and password as it requires the user to have a virtual or physical hardware solution that displays a time-sensitive code.

## Impact
To enable MFA for Amazon WorkSpaces you require a RADIUS server or a plugin to a RADIUS server already in use in your environment.

Multi-factor authentication is not available for Simple AD.

## Audit Procedure

### Using AWS Console

**For AWS Managed AD Authenticated Amazon Workspaces Environments:**

1. Identify the IP address of your **RADIUS MFA server** and your **AWS Managed Microsoft AD directory**
2. In the AWS Directory Service console navigation pane, select **Directories**
3. Choose the directory ID link for your AWS Managed Microsoft AD directory
4. On the Directories page, scroll to the **Multi-factor authentication** section
5. In the **Multi-factor authentication** section, confirm that it is **enabled** and that Radius Status is completed

**For Self-Managed AD (with AD Connector) Amazon Workspaces Environments:**

1. Identify the IP address and port of your **RADIUS MFA server** and your **AWS Managed Microsoft AD Connector Identifier**
2. In the AWS Workspaces console navigation pane, select **Directories**
3. Choose the **directory ID link** for your **AWS Managed Microsoft AD connector**
4. On the Directories page, select the **Actions > Update Details**
5. In the **Multi-factor authentication** section, confirm that it is enabled and that Radius Status is completed, **Enable Multi-Factor Authentication** is checked and the IP Address of your **Radius MFA server** matches that of the **RADIUS server IP address(es)** field

If it is not enabled or the Radius status is in another state refer to the remediation steps below.

## Remediation

### Using AWS Console

**For AWS Managed Microsoft AD based Workspaces Environments:**

1. Identify the IP address of your RADIUS MFA server and your AWS Managed Microsoft AD directory
2. In the AWS Directory Service console navigation pane, select **Directories**
3. Choose the directory ID link for your AWS Managed Microsoft AD directory
4. On the Directories page, scroll to the **Multi-factor authentication** section
5. In the Multi-factor authentication section, click **Actions**, and then click **Enable**
6. On the **Enable multi-factor authentication (MFA)** page, provide the following values:
   - Display label - Provide a label name
   - RADIUS server DNS name or IP addresses
     - Note - AWS Directory Service does not support RADIUS Challenge/Response authentication
   - Port - default 1812
   - Shared secret code
   - Confirm shared secret code
   - Protocol - MS-CHAPv2
   - Server timeout (in seconds) - 20
   - Max RADIUS request retries - 3
7. Click **Enable**

**Multi-factor authentication is available when the RADIUS Status changes to Enabled.**

**For AD Connector based Workspaces Environments:**

1. Identify the IP address and port of your **RADIUS MFA server** and, your **AWS Managed Microsoft AD Connector Identifier**
2. In the AWS Workspaces console navigation pane, select **Directories**
3. Choose the **directory ID link** for your **AWS Managed Microsoft AD directory connector**
4. On the Directories page, scroll to the **Multi-factor authentication** section and select **Edit**
5. In the Multi-factor authentication section, select **Enable Multi-factor authentication**
6. On the Multi-Factor Authentication section, provide the following values:
   - RADIUS server DNS name (s) or IP address (s)
   - Port - default 1812
   - Shared secret code
   - Confirm shared secret code
   - Protocol - MS-CHAPv2
   - Server timeout (in seconds) - 20
   - Max RADIUS request retries - 3
7. Click **Save**

## Default Value
By default, MFA is not enabled on AWS Workspaces. It requires a RADIUS server and an Active Directory environment.

## References
1. https://docs.aws.amazon.com/directoryservice/latest/admin-guide/ad_connector_mfa.html
2. https://docs.aws.amazon.com/directoryservice/latest/admin-guide/ms_ad_mfa.html
3. https://aws.amazon.com/blogs/security/how-to-enable-multi-factor-authentication-for-amazon-workspaces-and-amazon-quicksight-by-using-microsoft-ad-and-on-premises-credentials/

## CIS Controls
**v8:**
- 6.3 Require MFA for Externally-Exposed Applications
  - Require all externally-exposed enterprise or third-party applications to enforce MFA, where supported. Enforcing MFA through a directory service or SSO provider is a satisfactory implementation of this Safeguard.

**v7:**
- 16.3 Require Multi-factor Authentication
  - Require multi-factor authentication for all user accounts, on all systems, whether managed onsite or by a third-party provider.
