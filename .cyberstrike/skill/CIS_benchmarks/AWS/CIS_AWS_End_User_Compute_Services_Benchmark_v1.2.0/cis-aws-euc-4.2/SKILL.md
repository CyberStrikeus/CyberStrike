---
name: cis-aws-euc-4.2
description: "Ensure MFA is enabled for WorkDoc users"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, workdocs, mfa, authentication]
cis_id: "4.2"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: [CWE-308]
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure MFA is enabled for WorkDoc users (Manual)

## Profile Applicability

- Level 2

## Description

Multi-Factor Authentication (MFA) adds an extra layer of authentication assurance beyond traditional username and password. With MFA enabled, when a user signs in to Amazon WorkDocs, they will be prompted for their user name and password as well as for an authentication code from their MFA token.

## Rationale

Enabling MFA provides increased security to a user name and password as it requires the user to possess a solution that displays a time-sensitive authentication code.

## Impact

To enable MFA for Amazon WorkDocs you require a RADIUS server or a plugin to a RADIUS server already implemented in your environment.

Multi-factor authentication is not available for Simple AD.

You can enable multi-factor authentication for AD Connector if you have Active Directory running on-premises or in EC2 instances.

## Audit Procedure

Perform the steps below to confirm MFA setup and configuration.

### Using AWS Console

1. Log in to the Directory Service console at `https://console.aws.amazon.com/directoryservicev2`
2. Select **Directories**
3. Choose the directory ID link for your AWS Managed Microsoft AD directory
4. On the Directory details page, select the **Networking & security tab**
5. In the Multi-factor authentication section, Confirm Radius status is set to **Enabled**
6. Open the WorkDocs console at `https://console.aws.amazon.com/zocalo/`
7. In the Manage Your WorkDocs Sites page, select the desired site and choose **Actions** and **Manage MFA**
8. Confirm the values are set correctly

Multi-factor authentication is available when the RADIUS Status reads Enabled.

### Using AWS CLI

1. Run describe-directories command to list the identifiers of all the Active Directory (AD) Connector directories, available in the selected AWS region:

```bash
aws ds describe-directories \
  --region us-east-1 \
  --output table \
  --query 'DirectoryDescriptions[*].DirectoryId'
```

2. The command output should return a table with the requested resource IDs:

```
--------------------
|DescribeDirectories|
+------------------+
|  d-12345abcde    |
|  d-abcd012345    |
|  d-aabbcc1234    |
+------------------+
```

3. Run describe-directories command using the ID of the AD Connector directory to get the status of the RADIUS MFA server connection:

```bash
aws ds describe-directories \
  --region us-east-1 \
  --directory-ids d-12345abcde \
  --query 'DirectoryDescriptions[*].RadiusStatus'
```

4. The command output should return the requested status information:

```
[]
```

5. Repeat steps 3 and 4 to determine the MFA status for other AD Connector directories
6. Change the AWS region by updating the --region command parameter value and repeat steps 1 – 5 to perform the audit process for other regions

If describe-directories command output returns an empty array, as shown in the example above, there is no RADIUS MFA server configured for the selected AD Directory, therefore the resource does not have Multi-Factor Authentication (MFA) protection enabled. Refer to the remediation below.

## Expected Result

RADIUS MFA is enabled for WorkDocs directories in Directory Service, and WorkDocs sites have MFA configured.

## Remediation

### Using AWS Console

Perform the following steps to setup MFA on the server and in WorkDocs:

1. Identify the IP address of your RADIUS MFA server and your AWS Managed Microsoft AD directory
2. In the AWS Directory Service console navigation pane, select **Directories**
3. Choose the directory ID link for your AWS Managed Microsoft AD directory
4. On the Directory details page, select the **Networking & security tab**
5. In the Multi-factor authentication section, choose **Actions**, and then choose **Enable**
6. On the Enable multi-factor authentication (MFA) page, provide the following values:
   - Display label - Provide a label name
   - RADIUS server DNS name or IP addresses
   - Port - default 1812
   - Shared secret code
   - Confirm shared secret code
   - Protocol - MS-CHAPv2
   - Server timeout - (in seconds) - 20
   - Max retries - 3

**To enable multi-factor authentication in WorkDocs:**

1. Open WorkDocs console at `https://console.aws.amazon.com/zocalo/`
2. In the Manage Your WorkDocs Sites page, select the desired site and choose **Actions** and **Manage MFA**
3. Enter the following values:
   - Enable Multi-Factor Authentication
   - Check to enable multi-factor authentication
   - RADIUS server IP address(es) - The IP addresses of your RADIUS server endpoints
   - Port - The port that your RADIUS server is using for communications. Default RADIUS server port (1812)
   - Shared secret code - The shared secret code that was specified when your RADIUS endpoints were created
   - Confirm shared secret code
   - Protocol - MS-CHAPv2
   - Server timeout - (in seconds) - 20
   - Max retries - 3
4. Choose **Enable**

### Using AWS CLI

Multi-factor authentication is available when the RADIUS Status changes to Enabled. To enable RADIUS-based MFA protection for your Active Directory (AD) Connector directories, perform the following actions:

**Note:** Enabling Multi-Factor authentication for AD Connector directories using the AWS Management Console is not currently supported.

1. Run the enable-radius command:

```bash
aws ds enable-radius \
  --region us-east-1 \
  --directory-id <value> \
  --radius-settings { "RadiusServers": ["<your-radius-server>.com"],"RadiusPort": 1812,"RadiusTimeout": 20,"RadiusRetries": 3,"SharedSecret": "radiusmfa","AuthenticationProtocol": "MS-CHAPv2","DisplayLabel": "RADIUS Multi-Factor Authentication","UseSameUsername": true }
```

2. Repeat step 1 for other AD Connectors and the Selected regions

## Default Value

By default, MFA is not enabled in AWS Workdocs.

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

## Profile

Level 2
