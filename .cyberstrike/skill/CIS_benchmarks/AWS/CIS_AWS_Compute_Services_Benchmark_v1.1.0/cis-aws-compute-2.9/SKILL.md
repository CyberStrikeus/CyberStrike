---
name: cis-aws-compute-2.9
description: "Ensure use of AWS Systems Manager to manage EC2 instances"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ec2, systems-manager, ssm, inventory, management]
cis_id: "2.9"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-2.6, cis-aws-compute-2.5]
prerequisites: []
severity_boost: {}
---

# Ensure use of AWS Systems Manager to manage EC2 instances

## Description
An inventory and management of Amazon Elastic Compute Cloud (Amazon EC2) instances is made possible with AWS Systems Manager.

## Rationale
Use AWS Systems Manager to provide detailed system configurations, operating system patch levels, services name and type, software installations, application name, publisher and version, and other details about your environment.

## Impact
Setting up Systems Manager requires creating IAM users, groups, roles, and instance profiles. This adds administrative overhead but provides centralized management of EC2 instances.

## Audit Procedure

### Using AWS CLI
No specific CLI audit command is provided for this control. Use the console method below.

### Using AWS Console

1. Login to EC2 using https://console.aws.amazon.com/systems-manager/
2. On the left Click `Node Management`, click `Inventory`.
3. On the Dashboard confirm that all of your Instances are listed as part of your inventory.

If any instances are missing or AWS Systems Manager is not configured, refer to the remediation below.

## Expected Result
All EC2 instances should appear in the AWS Systems Manager Inventory dashboard.

## Remediation

### Using AWS CLI
No specific CLI remediation command is provided for this control. Use the console method below.

### Using AWS Console

These directions already assume your AWS account is setup. They will walk you through how to create non-Admin IAM users and groups for System Manager.

**1. Create a user group:**

a. Login to IAM using https://console.aws.amazon.com/iam/
b. On the left Click `Access management`, click `User groups`, and then click `Create Group`.
c. On the `Create user group` page, enter a name for the group.
d. Select and add the users required to the Group.
e. Attach permissions policies by selecting `ResourceGroupsandTagEditorFullAccess` policy.
f. Then for Full access to Systems Manager console, click the `AmazonSSMFullAccess` policy.
- OR
g. For access to view Systems Manager data, and not create or update resources, click the `AmazonSSMReadOnlyAccess` policy.
h. For access to the Built-In Insights and Dashboard by CloudWatch pages in the Systems Manager console, add these policies:
- AWSHealthFullAccess
- AWSConfigUserAccess
- CloudWatchReadOnlyAccess
i. Click `Create group`.

**2. Create users and assign permissions:**

a. Login to IAM using https://console.aws.amazon.com/iam/
b. On the left Click `Access management`, click `Users`, and then click `Add users`.
c. `User name`, enter the name that the user will use to sign in to AWS Systems Manager.
d. To allow the user access to development tools, select the check box next to Access key - Programmatic access.
e. To allow user access to the AWS Management Console, select the check box next to AWS Management Console access.
f. Click `Next: Permissions`.
g. To Set permissions, click `Add user to group`.
h. In the `group list`, click the group you created in step 1.
i. Then click `Next: Tags`.
j. (Optional) Add one or more tags.
k. Click `Next: Review` to see the list of group memberships.
l. Click `Create user`.

**3. To add permissions for an existing user:**

a. In the IAM console, click `Users`.
b. Click the name of the user to add to a group.
c. Then click `Add permission`.
d. For `Add user to group`, select the box next to the group to add the user to.
e. Add any other available permission policies to assign to the user.
f. Click `Next: Review`.
g. Click `Add permissions`.

**4. Create an IAM instance profile for Systems Manager:**

a. Login to the IAM console at https://console.aws.amazon.com/iam/
b. In the left, click `Roles`, and then click `Create role`.
c. Under `Select type of trusted entity`, click `AWS service`.
d. Click `EC2`, and then click `Next: Permissions`.
e. On the `Attach permissions policies` page, locate `AmazonSSMManagedInstanceCore`. Select the box next to it.
f. Click `Next: Tags`.
g. Add one or more tag-key value pairs.
h. Click `Next: Review`.
i. For `Role name`, enter a name for your new instance profile.
j. For `Role description`, enter a description for this instance profile.
k. Click `Create role`.

**Note:** If you plan to join instances to an Active Directory managed by AWS Directory Service, search for AmazonSSMDirectoryServiceAccess and select the box next to its name. If you plan to use EventBridge or CloudWatch Logs, search for CloudWatchAgentServerPolicy and select the box next to its name.

**5. Attach the Systems Manager instance profile to an existing instance:**

a. Login to the EC2 console at https://console.aws.amazon.com/ec2/
b. In the left pane, under `Instances`, click `Instances`.
c. Select the instance from the list.
d. In the `Actions menu`, click `Security, Modify IAM role`.
e. Select the instance profile you created in Step 4.
f. Click `Save`.

**6. Attach an IAM instance profile to an Amazon EC2 instance at launch:**

a. Login to the EC2 console at https://console.aws.amazon.com/ec2/
b. Select or confirm the `AWS Region` for the instance.
c. Click `Launch Instance`.
d. Locate the AMI for the instance type you want to create, and then click `Select`.
e. Select the type of instance to launch, then click `Next: Configure Instance Details`.
f. On the `Configure Instance Details` page, in the `IAM role` dropdown list, select the instance profile you created in Step 4.
g. For other options on the page, make selections that meet your requirements for the instance.
h. Complete the `wizard`.

If you create other instances that you want to configure using Systems Manager, specify the instance profile for each instance.

## Default Value
AWS Systems Manager is not configured by default for EC2 instances. It must be explicitly set up.

## References
1. https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-setting-up.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 1.1 Establish and Maintain Detailed Enterprise Asset Inventory | x | x | x |
| v7 | 1.4 Maintain Detailed Asset Inventory | x | x | x |

## Profile
Level 2 | Manual
