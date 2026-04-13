---
name: cis-aws-euc-2.1
description: "Ensure Administration of WorkSpaces is defined using IAM"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, workspaces, iam, authorization]
cis_id: "2.1"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-euc-2.2]
prerequisites: []
severity_boost: {}
---

# Ensure Administration of WorkSpaces is defined using IAM (Manual)

## Profile Applicability

- Level 1

## Description

To allow users to administer Amazon WorkSpaces, IAM policies must be created and attached with the required permissions to an IAM Principal used for administration of Amazon WorkSpaces. An IAM Principal may be a IAM Role or an IAM User, or an IAM User Group with Users within the User Group.

AWS has an AWS Managed Policy, `AmazonWorkSpacesAdmin` that grants permissions to administer Amazon WorkSpaces. A custom managed policy or inline policy may be used to grant WorkSpaces permissions to the IAM Principal.

## Rationale

Creating and managing Workspaces specific users is not done in AWS IAM. Creating and managing Workspaces specific users is done within the Workspace service console. In order to properly administer Workspaces specific users, an IAM Principal with proper permissions must be created.

## Impact

None specified in the benchmark.

## Audit Procedure

### Using AWS Console

1. Login in and open the IAM console at https://console.aws.amazon.com/iam/
2. In the left pane click on **User Groups**, **Users**, or **Roles**
3. Click on the IAM Principal (User, Group, or Role) that is to be used to administer Workspaces
4. Click on **Permissions** and confirm that the AmazonWorkSpacesAdmin policy or the proper permissions are attached

### Using AWS CLI

Run the appropriate command to determine permissions for the IAM Principal:

```bash
# For attached managed policies
aws iam list-attached-role-policies --role-name <workspace_group_name>

# For inline policies
aws iam get-role-policy --role-name <role_name> --policy-name <policy_name>
```

## Expected Result

The AWS managed policy AmazonWorkSpacesAdmin or a custom WorkSpaces Admin policy should be attached to the IAM Principal for administration of WorkSpaces.

## Remediation

### Using AWS Console

**If the IAM Principal for WorkSpaces Administration exists but does not have the policy attached:**

1. Login to the IAM console at https://console.aws.amazon.com/iam/
2. In the left pane click on either **User Groups**, **Users**, or **Roles**
3. Click the proper IAM Principal
4. Click on the **Permissions** tab
5. Click on **Attach Policy**
6. Select the **AmazonWorkSpacesAdmin** Policy or attach the desired Managed Policy
7. Click **Attach Policy**

**For Groups:**

1. Login to the IAM console at https://console.aws.amazon.com/iam/
2. In the left pane click on **Groups**
3. Select the **Group**
4. Click on the **Permissions** tab
5. Click on **Attach Policy**
6. Select the **AmazonWorkSpacesAdmin** Policy
7. Click **Attach Policy**

### Using AWS CLI

Attach the AmazonWorkSpacesAdmin policy by running the `aws iam attach-role-policy` command:

```bash
aws iam attach-role-policy --policy-arn arn:aws:iam::aws:policy/AmazonWorkSpacesAdmin --role-name <WorkSpaces_Admin_Role>
```

## Default Value

By default, Policy: AmazonWorkSpacesAdmin Function: Provides access to Amazon WorkSpaces administrative actions via AWS SDK and CLI. The default policy includes extensive permissions for managing WorkSpaces resources including:

- kms:DescribeKey, kms:ListAliases, kms:ListKeys
- workspaces:CreateTags, workspaces:CreateWorkspaceImage, workspaces:CreateWorkspaces, workspaces:CreateWorkspacesPool
- workspaces:DeleteTags, workspaces:DeregisterWorkspaceDirectory, workspaces:DescribeTags
- workspaces:DescribeWorkspaceBundles, workspaces:DescribeWorkspaceDirectories, workspaces:DescribeWorkspaces
- workspaces:DescribeWorkspacesPools, workspaces:DescribeWorkspacesPoolSessions
- workspaces:DescribeWorkspacesConnectionStatus, workspaces:ModifyCertificateBasedAuthProperties
- workspaces:ModifySamlProperties, workspaces:ModifyStreamingProperties, workspaces:ModifyWorkspaceCreationProperties
- workspaces:ModifyWorkspaceProperties, workspaces:RebootWorkspaces, workspaces:RebuildWorkspaces
- workspaces:RegisterWorkspaceDirectory, workspaces:RestoreWorkspace, workspaces:StartWorkspaces
- workspaces:StartWorkspacesPool, workspaces:StopWorkspaces, workspaces:StopWorkspacesPool
- workspaces:TerminateWorkspaces, workspaces:TerminateWorkspacesPool, workspaces:TerminateWorkspacesPoolSession
- workspaces:UpdateWorkspacesPool
- And several other managed policies for application management, PCA access, pool service access, secure browser access, thin client access, and web service access

## References

1. https://docs.aws.amazon.com/workspaces/latest/adminguide/workspaces-access-control.html
2. https://docs.aws.amazon.com/workspaces/latest/adminguide/manage-workspaces-users.html
3. https://docs.aws.amazon.com/IAM/latest/UserGuide/id.html

## Additional Information

AWS provides guidance on the usage of IAM Roles, IAM Users, IAM Groups, and the root user. AWS recommends not using the root user for everyday tasks.
https://docs.aws.amazon.com/IAM/latest/UserGuide/id.html

## CIS Controls

**v8:**

- 3.3 Configure Data Access Control Lists
  - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.

**v7:**

- 14.6 Protect Information through Access Control Lists
  - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.
