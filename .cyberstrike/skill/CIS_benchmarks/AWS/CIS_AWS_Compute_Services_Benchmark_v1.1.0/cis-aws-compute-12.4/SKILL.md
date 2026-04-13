---
name: cis-aws-compute-12.4
description: "Ensure least privilege is used with Lambda function access"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, lambda, serverless, iam, least-privilege, access-control]
cis_id: "12.4"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-12.5, cis-aws-compute-12.6, cis-aws-compute-12.9, cis-aws-compute-12.10]
prerequisites: []
severity_boost: {}
---

# Ensure least privilege is used with Lambda function access

## Description

Lambda is fully integrated with IAM, allowing you to control precisely what each Lambda function can do within the AWS Cloud. As you develop a Lambda function, you expand the scope of this policy to enable access to other resources. For example, for a function that processes objects put into an S3 bucket, it requires read access to objects stored in that bucket. Do not grant the function broader permissions to write or delete data, or operate in other buckets.

## Rationale

You can use AWS Identity and Access Management (IAM) to manage access to the Lambda API and resources like functions and layers. For users and applications in your account that use Lambda, you manage permissions in a permissions policy that you can apply to IAM users, groups, or roles. To grant permissions to other accounts or AWS services that use your Lambda resources, you use a policy that applies to the resource itself.

## Impact

Determining the exact permissions required is a manual process and can be challenging, since IAM permissions are very granular and they control access to both the data plane and control plane.

## Audit Procedure

### Using AWS Console

Determining the exact permissions required is a manual process and can be challenging, since IAM permissions are very granular and they control access to both the data plane and control plane.
Please refer to the references section below for useful documentation on developing the correct IAM policies for Lambda.

### Using AWS CLI

N/A - This control requires manual review of IAM policies.

## Expected Result

Lambda functions have granular IAM permissions following the principle of least privilege, with access limited to only necessary resources and operations.

## Remediation

### Using AWS Console

As building out the IAM permissions for Lambda here are some things to consider:

- Set granular IAM permissions for Lambda functions.
- Limit user access via IAM permissions to only necessary resources and operations.
- Remove unused or outdated IAM Users, Roles and Permissions.
- Periodically review and adjust IAM permissions.
- Do not allow all-access permissions for Lambda functions as a short cut.

### Using AWS CLI

N/A - This control requires manual IAM policy review and adjustment.

## Default Value

Lambda functions are created with a basic execution role by default, but the exact permissions depend on the role configuration.

## References

1. https://docs.aws.amazon.com/service-authorization/latest/reference/reference_policies_actions-resources-contextkeys.html
2. https://awspolicygen.s3.amazonaws.com/policygen.html
3. https://policysim.aws.amazon.com/home/index.jsp?#
4. https://github.com/aws-samples/aws-iamctl/
5. https://docs.aws.amazon.com/lambda/latest/operatorguide/least-privilege-iam.html

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | x    | x    | x    |
| v8               | 6.7 Centralize Access Control - Centralize access control for all enterprise assets through a directory service or SSO provider, where supported.                                                                                               |      | x    | x    |
| v7               | 1.7 Deploy Port Level Access Control - Utilize port level access control, following 802.1x standards, to control which devices can authenticate to the network.                                                                                 |      | x    | x    |
| v7               | 7.8 Implement DMARC and Enable Receiver-Side Verification - To lower the chance of spoofed or modified emails from valid domains, implement Domain-based Message Authentication, Reporting and Conformance (DMARC) policy and verification.     |      | x    | x    |

## Profile

Level 1 | Manual
