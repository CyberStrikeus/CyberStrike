---
name: cis-aws-foundations-2.13
description: "Ensure IAM users receive permissions only through groups"
category: cis-iam
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, iam, groups, permissions, policies, least-privilege]
cis_id: "2.13"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-2.14, cis-aws-foundations-2.15]
prerequisites: []
severity_boost: {}
---

# Ensure IAM users receive permissions only through groups

## Description
IAM users are granted access to services, functions, and data through IAM policies. There are four ways to assign policies to a user:

1. Attach an inline (user) policy directly to the user
2. Attach a managed policy directly to the user
3. Add the user to an IAM group with attached policies
4. Add the user to an IAM group with inline policies

Only assigning permissions through IAM groups is recommended.

## Rationale
Assigning IAM policies through groups centralizes permissions management and aligns access with organizational roles. This reduces complexity and lowers the likelihood of excessive or inconsistent permissions.

## Impact
Directly assigning policies to users increases the risk of misconfigured or excessive permissions and makes access management more difficult to audit and maintain.

## Audit Procedure

### Using AWS CLI

1. Run the following command to list all IAM users:

```bash
aws iam list-users --query 'Users[*].UserName' --output text
```

2. For each user returned, run:

```bash
aws iam list-attached-user-policies --user-name <user-name>
aws iam list-user-policies --user-name <user-name>
```

3. If any policies are returned, the user has either:
- A directly attached managed policy, or
- An inline policy

## Expected Result
For each IAM user, both `list-attached-user-policies` and `list-user-policies` should return empty results. All permissions should be assigned through IAM groups only.

## Remediation

### Using AWS Console

Create and configure a group:

1. Sign in to the AWS Management Console and open the IAM console (https://console.aws.amazon.com/iam/)
2. In the navigation pane, click `User Groups` and then click `Create Group`
3. Enter a group name and click `Next`
4. Select the appropriate policies
5. Click `Create Group`

Add users to the group:

6. Navigate to `User Groups`
7. Select the group
8. Click `Add users` to group
9. Select users and click `Add users`

Remove direct user policies:

10. Navigate to `Users`
11. Select the user
12. Go to the `Permissions` tab
13. Remove any directly attached policies

### Using AWS CLI

1. Create a group:

```bash
aws iam create-group --group-name <group-name>
```

2. Attach a policy to the group:

```bash
aws iam attach-group-policy --group-name <group-name> --policy-arn <policy-arn>
```

3. Add user to group:

```bash
aws iam add-user-to-group --user-name <user-name> --group-name <group-name>
```

4. Detach managed policies from user:

```bash
aws iam detach-user-policy --user-name <user-name> --policy-arn <policy-arn>
```

5. Delete inline policies from user:

```bash
aws iam delete-user-policy --user-name <user-name> --policy-name <policy-name>
```

## Default Value
By default, AWS allows IAM policies to be attached directly to users, groups, or roles. There are no restrictions preventing direct user policies unless enforced through organizational standards.

## References
1. http://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html
2. http://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_managed-vs-inline.html
3. CCE-78912-3

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 6.8 Define and Maintain Role-Based Access Control - Define and maintain role-based access control, through determining and documenting the access rights necessary for each role within the enterprise to successfully carry out its assigned duties. Perform access control reviews of enterprise assets to validate that all privileges are authorized, on a recurring schedule at a minimum annually, or more frequently. | | | x |
| v7 | 16.1 Maintain an Inventory of Authentication Systems - Maintain an inventory of each of the organization's authentication systems, including those located onsite or at a remote service provider. | | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1078.004 | TA0007, TA0008, TA0043 | M1018 |

## Profile
Level 1 | Automated
