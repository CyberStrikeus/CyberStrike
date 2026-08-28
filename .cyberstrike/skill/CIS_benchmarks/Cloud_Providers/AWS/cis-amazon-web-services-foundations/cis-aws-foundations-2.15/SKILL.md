---
name: cis-aws-foundations-2.15
description: "Ensure a support role has been created to manage incidents with AWS Support"
category: cis-iam
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, iam, support-role, incident-management, least-privilege]
cis_id: "2.15"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-2.14, cis-aws-foundations-2.13]
prerequisites: []
severity_boost: {}
---

# Ensure a support role has been created to manage incidents with AWS Support

## Description

AWS provides a Support Center that can be used for incident notification and response, as well as technical support and customer service. Create an IAM role with the appropriate policy assigned to allow authorized users to manage incidents with AWS Support.

## Rationale

Following the principle of least privilege, an IAM role should be used with a scoped policy to allow access to AWS Support. This ensures only authorized users can manage support cases without requiring broad administrative access.

## Impact

Without a dedicated support role, access to AWS Support may require overly permissive roles, increasing the risk of excessive access and reducing separation of duties.

## Audit Procedure

### Using AWS Console

1. Sign in to the AWS Management Console and open the IAM console at https://console.aws.amazon.com/iam
2. In the left navigation pane, under `Access management`, select `Policies`
3. In the policy search field, enter `AWSSupportAccess`
4. Select the policy
5. Click the `Entities attached` tab
6. Ensure at least one `IAM Role` is attached

### Using AWS CLI

1. Identify the AWS managed support policy:

```bash
aws iam list-policies --query "Policies[?PolicyName=='AWSSupportAccess'].Arn" --output text
```

2. Check if it is attached to any roles:

```bash
aws iam list-entities-for-policy --policy-arn arn:aws:iam::aws:policy/AWSSupportAccess
```

3. Ensure that at least one role is listed under `PolicyRoles`

## Expected Result

At least one IAM role should be attached to the `AWSSupportAccess` policy. The policy ARN is `arn:aws:iam::aws:policy/AWSSupportAccess`.

## Remediation

### Using AWS Console

1. Sign in to the AWS Management Console and open the IAM console
2. Navigate to `Roles`
3. Click `Create role`
4. Configure the trusted entity (e.g., your AWS account or identity provider)
5. Attach the `AWSSupportAccess` policy
6. Complete role creation
7. Assign the role to appropriate users or groups

### Using AWS CLI

1. Create a trust policy (example):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::<account-id>:root"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

2. Create the role:

```bash
aws iam create-role --role-name <role-name> --assume-role-policy-document file://trust-policy.json
```

3. Attach the AWS Support policy:

```bash
aws iam attach-role-policy --policy-arn arn:aws:iam::aws:policy/AWSSupportAccess --role-name <role-name>
```

## Default Value

By default, AWS does not create a dedicated support role. IAM users and roles with sufficient permissions (e.g., `AdministratorAccess`) can access the Support Center unless a specific role with the `AWSSupportAccess` policy is created.

## References

1. https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_managed-vs-inline.html
2. https://aws.amazon.com/premiumsupport/pricing/
3. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/iam/list-policies.html
4. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/iam/attach-role-policy.html
5. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/iam/list-entities-for-policy.html

## Additional Information

- The `AWSSupportAccess` policy is a global AWS managed policy with ARN: `arn:aws:iam::aws:policy/AWSSupportAccess`
- Avoid granting support access through broad policies like `AdministratorAccess`
- Assign the support role only to users who require it to maintain separation of duties

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 17.1 Designate Personnel to Manage Incident Handling - Designate one key person, and at least one backup, who will manage the enterprise's incident handling process. Management personnel are responsible for the coordination and documentation of incident response and recovery efforts and can consist of employees internal to the enterprise, third-party vendors, or a hybrid approach. If using a third-party vendor, designate at least one person internal to the enterprise to oversee any third-party work. Review annually, or when significant enterprise changes occur that could impact this Safeguard. | x    | x    | x    |
| v7               | 14.1 Segment the Network Based on Sensitivity - Segment the network based on the label or classification level of the information stored on the servers, locate all sensitive information on separated Virtual Local Area Networks (VLANs).                                                                                                                                                                                                                                                                                                                                                                              |      | x    | x    |

## Profile

Level 1 | Automated
