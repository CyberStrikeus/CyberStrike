---
name: cis-aws-database-2.4
description: "Ensure IAM Roles and Policies are Created"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, aurora, iam, roles, policies, access-management]
cis_id: "2.4"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-2.7, cis-aws-database-2.10]
prerequisites: []
severity_boost: {}
---

# 2.4 Ensure IAM Roles and Policies are Created (Manual)

## Description

AWS Identity and Access Management (IAM) helps manage access to AWS resources. While you cannot directly associate IAM roles with Amazon Aurora instances, you can use IAM roles and policies to define which AWS IAM users and groups have management permissions for Amazon RDS resources and what actions they can perform. Here is a guide:

## Rationale

Individual creates IAM roles and polices that define specific permission given to that role. This determines what the identity or instance can and cannot do.

## Impact

If an IAM Role is not created, then it would be challenging to access AWS resources.

## Audit Procedure

### Using AWS Console

1. **Sign in to AWS Management Console**
   - If you do not already have an AWS account, you will need to create one at https://aws.amazon.com.

2. **Navigate to IAM Dashboard**
   - Navigate to the IAM service once logged in to the AWS Management Console.
   - This is under the `Security, Identity, & Compliance` category.

3. **Create a New IAM Role**
   - In the IAM Dashboard, find the `Roles` section on the left-side navigation pane and click on it. Then, click on the `Create Role` button.

4. **Select the Service that will Use the Role**
   - Choose `RDS` as the AWS service that will use this new role, then click `Next: Permissions`.

5. **Attach Policy**
   - In the next screen, you can attach policies defining this role's permissions. You can use the filter to find existing policies like `AmazonRDSFullAccess` or `AmazonRDSReadOnlyAccess`.
   - Select the appropriate policy and then click `Next: Tags`.

6. **Add Tags (Optional)**
   - You can add metadata to the role by attaching tags as key-value pairs. This is optional, and you can proceed to the next step if you do not wish to add tags.

7. **Review**
   - Provide a name and a description for the role. Review the role and then click `Create Role`.

8. **Creating IAM Policy (Optional)**
   - You can create a custom IAM policy if the predefined policies do not meet your requirements.
   - Navigate to `Policies` in the IAM dashboard and click `Create Policy`.
   - Use the visual editor or JSON editor to define the permissions.
   - Once done, click `Review Policy`, give it a name and a description, and click `Create Policy`.
   - You can then attach this custom policy to the IAM role.

9. **Assign the IAM Role to an IAM User or Group**
   - To assign the newly created role to an IAM User or Group:
   - Navigate to the user or group in the IAM dashboard.
   - Click `Add permissions`.
   - Then `Attach existing policies directly`.
   - Use the filter to find your new role and select it.
   - Click `Next: Review` and then `Add permissions`.

## Expected Result

IAM roles with appropriate policies should exist for managing Amazon Aurora/RDS resources. Users and groups should have the necessary IAM roles attached.

## Remediation

Follow the audit procedure steps above to create IAM roles and policies for Amazon Aurora access management.

## Default Value

No Aurora-specific IAM roles are created by default. Users must create and configure IAM roles and policies according to their access management requirements.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | x | x | x |

## Profile

Level 1 | Manual
