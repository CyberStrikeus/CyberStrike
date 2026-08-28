---
name: cis-aws-euc-2.3
description: "Ensure WorkSpace volumes are encrypted"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, workspaces, encryption, kms, data-protection]
cis_id: "2.3"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-euc-2.4]
prerequisites: []
severity_boost: {}
---

# Ensure WorkSpace volumes are encrypted (Automated)

## Profile Applicability

- Level 1

## Description

Encrypt WorkSpaces root volume (C:drive for Windows and root for Amazon Linux) and user volume (D:drive for Windows and /home for Amazon Linux).

## Rationale

When you launch a WorkSpace, you can encrypt the root volume and the user volume. This ensures that the data stored at rest for WorkSpaces is encrypted.

## Impact

You must encrypt a WorkSpace when it is launched. You cannot create a custom image from an encrypted WorkSpace. You cannot disable encryption once encryption is enabled for a WorkSpace. You must enable to AWS KMS CMK prior to rebuilding/rebooting an encrypted WorkSpace or it becomes unusable.

## Audit Procedure

### Using AWS Console

1. Login to the WorkSpaces dashboard at https://console.aws.amazon.com/workspaces/
2. In the left pane click **WorkSpaces** to access the instances listing page
3. Check the storage volume(s) encryption status for each Amazon WorkSpaces instance available in the current AWS region
   - It will be listed in the Volume Encryption column

If the value listed in the Volume Encryption column is Disabled, the selected AWS WorkSpaces instance volumes are not encrypted.

4. Change the AWS region from the navigation bar and repeat step 3 for all other regions

### Using AWS CLI

1. Run describe-workspaces command (OSX/Linux/UNIX) using custom query filters to list the IDs of all AWS WorkSpaces instances available within the selected region:

```bash
aws workspaces describe-workspaces --region us-east-1 --output table --query 'Workspaces[*].WorkspaceId'
```

2. The command output should return a table with the requested WorkSpaces IDs:

```
--------------------
|DescribeWorkspaces|
+------------------+
|  ws-aaabbbccc    |
|  ws-ccceeefff    |
+------------------+
```

3. Execute again describe-workspaces command (OSX/Linux/UNIX) using the name of the WorkSpaces instance as identifier and custom query filters to get the encryption status for both root and user storage volumes:

```bash
aws workspaces describe-workspaces --region us-east-1 --workspace-ids ws-aaabbbccc --query 'Workspaces[*].[RootVolumeEncryptionEnabled,UserVolumeEncryptionEnabled]'
```

4. The command output should return the encryption status (flag) for both root and user instance volumes (true for enabled, false for disabled):

```
[
    [
        false,
        false
    ]
]
```

If the returned flag value for both root and user volumes is false (as shown in the output example above), the selected AWS WorkSpaces instance volumes are not encrypted.

5. Repeat step 3 and 4 to verify the storage volumes encryption status for other AWS WorkSpaces instances provisioned in the current region
6. Change the AWS region by updating the --region command parameter value and repeat steps 1 - 5 to perform the audit process for other regions

If the selected AWS WorkSpaces instance volumes are not encrypted, refer to the remediation procedure below.

## Expected Result

Both `RootVolumeEncryptionEnabled` and `UserVolumeEncryptionEnabled` should return `true`.

## Remediation

### Using AWS Console

1. Login to the WorkSpaces console at https://console.aws.amazon.com/workspaces/
2. Click **Launch WorkSpaces** and complete the first three steps
3. For the WorkSpaces Configuration step, do the following:
   - Select the volumes to encrypt: Root Volume, User Volume, or both volumes
   - For Encryption Key, select an AWS KMS CMK. The CMK that you select must be symmetric

4. Click **Next Step**
5. Click **Launch WorkSpaces**

**NOTE:**
To encrypt existing AWS WorkSpaces data you must re-create the necessary WorkSpaces instances with the volumes encryption feature enabled as outlined above.

### Using AWS CLI

1. Run the `create-workspaces` command:

```bash
aws workspaces create-workspaces --workspaces DirectoryId='your_directoryID',
UserName='user_for_workspace',
BundleId='workspace_bundle_ID',
VolumeEncryptionKey='AWS_KMS_customer_master_key_(CMK)',
UserVolumeEncryptionEnabled='true',
RootVolumeEncryptionEnabled='true',
WorkspaceProperties={RunningMode='AUTO_STOP',
RunningModeAutoStopTimeoutInMinutes='10', RootVolumeSizeGib='root_GB',
UserVolumeSizeGib='user_GB', ComputeTypeName='STANDARD'}
```

2. You will receive output highlighting:
   - FailedRequests - Will contain information about the WorkSpaces that could not be created, and the reason they failed
   - PendingRequests - Will contain information about the WorkSpaces that were created and the command was successful

## Default Value

By default, AWS Workspaces utilize **Elastic Block Store (AWS EBS)** by default to encrypt data at rest (https://docs.aws.amazon.com/workspaces/latest/adminguide/data-protection.html)

AWS Workspaces utilizes **TLS 1.2 encryption and SigV4 request signing** by default to encrypt data in transit. **DCV**, streaming and control data in-transit is encrypted using **TLS 1.3 encryption for UDP traffic** and **TLS 1.2 encryption for TCP traffic, with AES-256 ciphers**.

For DCV, streaming and control data in-transit is encrypted using TLS 1.3 encryption for UDP traffic and TLS 1.2 encryption for TCP traffic, with AES-256 ciphers.

## References

1. https://docs.aws.amazon.com/workspaces/latest/adminguide/encrypt-workspaces.html
2. https://docs.aws.amazon.com/workspaces/latest/adminguide/data-protection.html
3. https://docs.aws.amazon.com/kms/latest/developerguide/viewing-keys-console.html#viewing-console-details

## CIS Controls

**v8:**

- 3.11 Encrypt Sensitive Data at Rest
  - Encrypt sensitive data at rest on servers, applications, and databases containing sensitive data. Storage-layer encryption, also known as server-side encryption, meets the minimum requirement of this Safeguard. Additional encryption methods may include application-layer encryption, also known as client-side encryption, where access to the data storage device(s) does not permit access to the plain-text data.

**v7:**

- 14.8 Encrypt Sensitive Information at Rest
  - Encrypt all sensitive information at rest using a tool that requires a secondary authentication mechanism not integrated into the operating system, in order to access the information.
