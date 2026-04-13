---
name: cis-aws-foundations-2.21
description: 'Ensure AWS resource policies do not allow unrestricted access using "Principal": "*"'
category: cis-iam
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, iam, resource-policies, principal-wildcard, s3, sqs, sns, lambda, least-privilege]
cis_id: "2.21"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-2.14, cis-aws-foundations-2.18]
prerequisites: []
severity_boost: {}
---

# Ensure AWS resource policies do not allow unrestricted access using "Principal": "\*"

## Description

Ensure AWS resource-based policies, such as Amazon S3 bucket policies, Amazon SQS queue policies, Amazon SNS topic policies, and AWS Lambda resource policies, do not grant unrestricted access using `"Principal": "*"` with `"Effect": "Allow"` unless the policy includes restrictive conditions that limit access to specific trusted identities, accounts, services, or network boundaries.

## Rationale

Resource-based policies are evaluated alongside identity-based IAM policies during authorization decisions. When a policy statement specifies `"Principal": "*"` with `"Effect": "Allow"`, it grants the specified permissions to any AWS principal unless additional conditions restrict the request. This may unintentionally allow access from users, roles, or services in any AWS account. Such broad access significantly increases the risk of unauthorized data access, resource abuse, or data exfiltration.

## Impact

Unrestricted resource-based policies may expose data or services to unauthorized access, potentially leading to data breaches, service misuse, or unintended public exposure.

## Audit Procedure

1. Identify resources that support resource-based policies within the AWS account, such as S3 buckets, SQS queues, SNS topics, and Lambda functions
2. Retrieve the resource policies for each resource. Example CLI commands:

### SQS Queue Policies

```bash
aws sqs get-queue-attributes \
  --queue-url https://sqs.region.amazonaws.com/account/QUEUE \
  --attribute-names Policy
```

### S3 Bucket Policies

```bash
aws s3api get-bucket-policy \
  --bucket YOUR-BUCKET-NAME
```

### SNS Topic Policies

```bash
aws sns get-topic-attributes \
  --topic-arn TOPIC-ARN \
  --query "Attributes.Policy" \
  --output text
```

3. Inspect the retrieved policies and identify statements containing:

- `"Effect": "Allow"` AND `"Principal": "*"`

  OR

- `"Principal": {"AWS": "*"}`

4. Evaluate whether the statement includes restrictive conditions such as:

- `aws:SourceArn`
- `aws:SourceAccount`
- `aws:PrincipalArn`
- Other service-specific condition keys

5. Determine audit status:

- **Compliant:** Wildcard principals are present only when restrictive conditions limit access to trusted principals or services
- **Non-Compliant:** Wildcard principals are used without sufficient restrictions

## Expected Result

All resource-based policies that use `"Principal": "*"` should include restrictive conditions (such as `aws:SourceArn`, `aws:SourceAccount`, or `aws:PrincipalArn`) that limit access to specific trusted entities. Policies without such conditions are non-compliant.

## Remediation

If a resource policy contains `"Principal": "*"` with `"Effect": "Allow"` and lacks sufficient restrictions, modify the policy to limit access.

### OPTION 1 - Restrict the Principal

Replace the wildcard principal (`"Principal": "*"`) with a specific account, role, user, or service.

Example: Non-Compliant Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowPublicAccess",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:us-east-1:123456789012:my-queue"
    }
  ]
}
```

Steps:

1. Retrieve the current policy:

```bash
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/my-queue \
  --attribute-names Policy \
  --query 'Attributes.Policy'
```

2. Update the policy with a specific principal:

```bash
aws sqs set-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/my-queue \
  --attributes '{
    "Policy": "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Sid\":\"AllowSpecificAccount\",\"Effect\":\"Allow\",\"Principal\":{\"AWS\":\"arn:aws:iam::345678901234:root\"},\"Action\":\"sqs:SendMessage\",\"Resource\":\"arn:aws:sqs:us-east-1:123456789012:my-queue\"}]}"
  }'
```

Resulting Compliant Policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowSpecificAccount",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::345678901234:root"
      },
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:us-east-1:123456789012:my-queue"
    }
  ]
}
```

### OPTION 2 - Restrict Using Conditions

If a wildcard principal is required, add restrictive conditions.

Example compliant policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowServiceIntegration",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:us-east-1:123456789012:my-queue",
      "Condition": {
        "StringEquals": {
          "aws:SourceAccount": "345678901234"
        }
      }
    }
  ]
}
```

## Default Value

By default, AWS does not prevent the use of `"Principal": "*"` in resource-based policies. Policies may allow unrestricted access unless explicitly restricted through policy definitions or organizational controls. It is the responsibility of the customer to ensure that resource policies are properly scoped and do not grant unintended public or cross-account access.

## References

- AWS IAM Policy Evaluation Logic
- AWS S3 Bucket Policy Documentation
- AWS SQS Queue Policy Documentation
- AWS SNS Topic Policy Documentation

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                                      | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                                              | x    | x    | x    |
| v8               | 6.8 Define and Maintain Role-Based Access Control - Define and maintain role-based access control, through determining and documenting the access rights necessary for each role within the enterprise to successfully carry out its assigned duties. Perform access control reviews of enterprise assets to validate that all privileges are authorized, on a recurring schedule at a minimum annually, or more frequently. |      |      | x    |

## Profile

Level 1 | Manual
