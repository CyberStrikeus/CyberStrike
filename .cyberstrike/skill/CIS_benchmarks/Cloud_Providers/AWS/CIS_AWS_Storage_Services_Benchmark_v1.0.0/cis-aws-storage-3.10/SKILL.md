---
name: cis-aws-storage-3.10
description: "Ensure managing AWS EFS access points"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, efs, access-points, access-control, iam]
cis_id: "3.10"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-3.7, cis-aws-storage-3.11]
prerequisites: []
severity_boost: {}
---

# 3.10 Ensure managing AWS EFS access points (Manual)

## Profile Applicability

- Level 2

## Description

EFS access points serve as gateways to your EFS file system, allowing applications to interact with the file system across various resources. Proper configuration of these access points within your applications is crucial to ensure seamless and secure access. By configuring EFS access points, you can control and manage which users have access to specific resources in your EFS environment, enhancing security and operational efficiency.

## Rationale

The rationale behind properly configuring EFS access points is to ensure secure and efficient interaction between your applications and the EFS file system. By setting up these access points correctly, you can control and manage user permissions, ensuring that only authorized users can access specific resources. This not only enhances the security of your data but also improves operational efficiency by preventing unauthorized access and potential data breaches.

## Impact

Without properly configured EFS access points, you may experience inefficient and insecure access to your EFS file system. This can lead to unauthorized users gaining access to sensitive data, resulting in potential data breaches and security vulnerabilities. Additionally, improper configuration can cause operational inefficiencies, as managing user permissions becomes more complex and error-prone, ultimately impacting the overall security and performance of your infrastructure.

## Audit Procedure

### Console

1. **Creating an EFS access point**:
   You can create an EFS access point through the Amazon CLI, AWS console, and with the EFS API. An EFS can only have up to 1,000 access points.

2. **Mounting an EFS access point**:
   Consult the section where we mounted an EFS file system on an EC2 instance. While inside the resource you want to configure an access point for, type in this command:

   ```
   mount -t efs -o tls,iam,accesspoint=fsap-abcdef0123456789a fs-abc0123def456789a: /localmountpoint
   ```

3. **Enforcing a User Identity with an EFS access point**:
   You can enforce user identity to ensure that users and groups with proper permissions are able to access the EFS system. In order to do this, you must specify the user and group ID you wish to have ownership of the files.

   When `enforcement` is enabled, that file that is was created by the user will automatically show ownership belong to the user. When enforcement is enabled, the access point considers the User ID, group ID, and secondary group ID. It ignored the NFS client's ID.

4. **Enforcing a root directory with an access point**:
   If you wish to override the root directory of the EFS, you can make the root directory that of the access point. To enforce the root directory with an access point, you must specify three things upon provisioning the EFS mount point:
   - Owner UID
   - Group GID
   - Permissions

   To access an EFS from an access point, a root directory must be created and enforced. Reminder: You must specify permissions for the access point root directory. If these permissions are not defined, a root directory will not be created on the mount point, and you will not be able to access EFS from an access point.

5. **Security Model for access point root directories**:
   When a root directory override is in effect, the EFS behaves like a Linux server with a no_subtree_check option enabled.

## Expected Result

- EFS access points should be properly configured
- User identity enforcement should be configured when required
- Root directory should be properly configured with owner UID, group GID, and permissions
- Access points should not exceed the limit of 1,000 per file system
- Proper mount commands should be used with IAM authentication

## Remediation

### Console

Implement AWS EFS access points:

1. Create EFS access points via AWS Console, CLI, or API
2. Configure user identity enforcement with proper user/group IDs
3. Set up root directory override with:
   - Owner UID
   - Group GID
   - Permissions
4. Mount access points using proper IAM authentication:
   ```
   mount -t efs -o tls,iam,accesspoint=fsap-abcdef0123456789a fs-abc0123def456789a: /localmountpoint
   ```
5. Verify access point configuration and permissions

## Default Value

EFS access points are not created by default. Users must explicitly create and configure access points, including user identity enforcement and root directory settings.

## References

1. https://docs.aws.amazon.com/efs/latest/ug/efs-access-points.html

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists<br/>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                                              | ●    | ●    | ●    |
| v8               | 6.8 Define and Maintain Role-Based Access Control<br/>Define and maintain role-based access control, through determining and documenting the access rights necessary for each role within the enterprise to successfully carry out its assigned duties. Perform access control reviews of enterprise assets to validate that all privileges are authorized, on a recurring schedule at a minimum annually, or more frequently. |      |      | ●    |
| v7               | 14.6 Protect Information through Access Control Lists<br/>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.                       | ●    | ●    | ●    |
| v7               | 14.7 Enforce Access Control to Data through Automated Tools<br/>Use an automated tool, such as host-based Data Loss Prevention, to enforce access controls to data even when data is copied off a system.                                                                                                                                                                                                                      |      |      | ●    |

## Profile

Level 2
