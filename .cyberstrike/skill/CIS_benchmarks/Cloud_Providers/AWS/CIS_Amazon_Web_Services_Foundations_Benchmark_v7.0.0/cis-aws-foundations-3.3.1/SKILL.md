---
name: cis-aws-foundations-3.3.1
description: "Ensure that encryption is enabled for EFS file systems"
category: cis-storage
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, efs, encryption, encryption-at-rest, kms]
cis_id: "3.3.1"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure that encryption is enabled for EFS file systems

## Description

EFS data should be encrypted at rest using AWS KMS (Key Management Service).

## Rationale

Data should be encrypted at rest to reduce the risk of a data breach via direct access to the storage device.

## Impact

EFS file system data-at-rest encryption must be turned on when creating the file system. If an EFS file system has been created without data-at-rest encryption enabled, then you must create another EFS file system with the correct configuration and transfer the data. There is no way to enable encryption on an existing unencrypted EFS file system.

## Audit Procedure

### Using AWS Console

1. Login to the AWS Management Console and Navigate to the Elastic File System (EFS) dashboard.
2. Select `File Systems` from the left navigation panel.
3. Each item on the list has a visible Encrypted field that displays data at rest encryption status.
4. Validate that this field reads `Encrypted` for all EFS file systems in all AWS regions.

### Using AWS CLI

1. Run the `describe-file-systems` command using custom query filters to list the identifiers of all AWS EFS file systems currently available within the selected region:

```bash
aws efs describe-file-systems --region --output table --query 'FileSystems[*].[FileSystemId,Encrypted]' --output table
```

2. The command output should return a table with the requested file system IDs.

3. Run the `describe-file-systems` command using the ID of the file system that you want to examine as `file-system-id` and the necessary query filters:

```bash
aws efs describe-file-systems --region <region> --file-system-id <file-system-id> --query 'FileSystems[*].Encrypted'
```

4. The command output should return the file system encryption status as `true` or `false`. If the returned value is `false`, the selected AWS EFS file system is not encrypted and if the returned value is `true`, the selected AWS EFS file system is encrypted.

## Expected Result

The `Encrypted` field should return `true` for all EFS file systems, indicating that encryption at rest is enabled using AWS KMS.

## Remediation

**It is important to note that EFS file system data-at-rest encryption must be turned on when creating the file system. If an EFS file system has been created without data-at-rest encryption enabled, then you must create another EFS file system with the correct configuration and transfer the data.**

### Using AWS Console

Steps to create an EFS file system with data encrypted at rest:

1. Login to the AWS Management Console and Navigate to the `Elastic File System (EFS)` dashboard.
2. Select `File Systems` from the left navigation panel.
3. Click the `Create File System` button from the dashboard top menu to start the file system setup process.
4. On the `Configure file system access` configuration page, perform the following actions:
   - Choose an appropriate VPC from the VPC dropdown list.
   - Within the `Create mount targets` section, check the boxes for all of the Availability Zones (AZs) within the selected VPC. These will be your mount targets.
   - Click `Next step` to continue.
5. Perform the following on the `Configure optional settings` page:
   - Create `tags` to describe your new file system.
   - Choose `performance mode` based on your requirements.
   - Check the `Enable encryption` box and choose `aws/elasticfilesystem` from the `Select KMS master key` dropdown list to enable encryption for the new file system, using the default master key provided and managed by AWS KMS.
   - Click `Next step` to continue.
6. Review the file system configuration details on the `review and create` page and then click `Create File System` to create your new AWS EFS file system.
7. Copy the data from the old unencrypted EFS file system onto the newly created encrypted file system.
8. Remove the unencrypted file system as soon as your data migration to the newly created encrypted file system is completed.
9. Change the AWS region from the navigation bar and repeat the entire process for the other AWS regions.

### Using AWS CLI

1. Run the `describe-file-systems` command to view the configuration information for the selected unencrypted file system identified in the Audit steps:

```bash
aws efs describe-file-systems --region <region> --file-system-id <file-system-id>
```

2. The command output should return the configuration information.

3. To provision a new AWS EFS file system, you need to generate a universally unique identifier (UUID) to create the token required by the `create-file-system` command. To create the required token, you can use a randomly generated UUID from "https://www.uuidgenerator.net".

4. Run the `create-file-system` command using the unique token created at the previous step:

```bash
aws efs create-file-system --region <region> --creation-token <uuid> --performance-mode generalPurpose --encrypted
```

5. The command output should return the new file system configuration metadata.

6. Run the `create-mount-target` command using the EFS file system ID returned from step 4 as the identifier and the ID of the Availability Zone (AZ) that will represent the mount target:

```bash
aws efs create-mount-target --region <region> --file-system-id <file-system-id> --subnet-id <subnet-id>
```

7. The command output should return the new mount target metadata.

8. Now you can mount your file system from an EC2 instance.

9. Copy the data from the old unencrypted EFS file system to the newly created encrypted file system.

10. Remove the unencrypted file system as soon as your data migration to the newly created encrypted file system is completed:

```bash
aws efs delete-file-system --region <region> --file-system-id <unencrypted-file-system-id>
```

11. Change the AWS region by updating the --region and repeat the entire process for the other AWS regions.

## Default Value

By default, when creating an EFS file system through the AWS Management Console, encryption at rest is enabled. When creating a file system using the AWS CLI, API, or SDKs, encryption is not enabled by default and must be explicitly specified.

## References

1. https://docs.aws.amazon.com/efs/latest/ug/encryption-at-rest.html
2. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/efs/index.html#efs

## CIS Controls

| Controls Version | Control                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.11 Encrypt Sensitive Data at Rest        |      | x    | x    |
| v7               | 14.8 Encrypt Sensitive Information at Rest |      |      | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1530                       | TA0009  | M1041       |

## Profile

Level 1 | Automated
