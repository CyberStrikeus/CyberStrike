---
name: cis-aws-database-4.2
description: "Ensure Fine-Grained Access Control is implemented"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, dynamodb, iam, fgac, access-control]
cis_id: "4.2"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-4.1]
prerequisites: []
severity_boost: {}
---

# 4.2 Ensure Fine-Grained Access Control is implemented

## Description

Fine-Grained Access Control (FGAC) on Amazon DynamoDB allows you to control access to data at the row level. Using IAM policies, you can restrict access based on the content within the request. Here is how you can implement FGAC:

## Rationale

Fine-Grained access control helps users to create and allow specific permission within that DB.

## Impact

N/A

## Audit Procedure

### Using AWS Console

1. Create an IAM Role
   - Sign in to the AWS Management Console and open the IAM console at https://console.aws.amazon.com/iam/.
   - In the navigation pane, choose `Roles` and select `Create role`.
   - Choose `AWS service` as the type of trusted entity.
   - Choose `DynamoDB` as the service that will use this role, then click `Next: Permissions`.
   - On the `Attach permissions policies` page, choose `Next: Tags`. You do not need to attach a policy to this role yet.
   - On the `Add tags` page, choose `Next: Review`.
   - On the `Review` page, for `Role name`, enter a name for your role, such as DynamoDBFineGrainedAccessRole.
   - Choose `Create role`.

2. Create an IAM Policy for Fine-Grained Access Control
   - In the navigation pane, choose `Policies` and select `Create policy`.
   - Choose the `JSON` tab.
   - Paste the following policy into the policy document field, replacing `us-west-2`, `123456789012`, `myddbtable`, `HK`, and `RANGEK` with your own values:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:BatchGetItem",
        "dynamodb:Query",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem"
      ],
      "Resource": "arn:aws:dynamodb:<us-west-2:123456789012:table/myddbtable>",
      "Condition": {
        "ForAllValues:StringEquals": {
          "dynamodb:LeadingKeys": ["${www.amazon.com:user_id}"],
          "dynamodb:Attributes": ["<HK>", "<RANGEK>"]
        },
        "StringEqualsIfExists": {
          "dynamodb:Select": "SPECIFIC_ATTRIBUTES"
        }
      }
    }
  ]
}
```

In this policy:

- `dynamodb:LeadingKeys` restrict access to only the items where the hash key value is the same as the user's ID.
- `dynamodb:Attributes` restrict access to only the "HK" and "RANGEK" attributes of the items.
- `dynamodb:Select` only allows the `SPECIFIC_ATTRIBUTES` operator.
- Choose `Next: Tags`, add any tags if needed, and then choose `Next: Review`.
- For `Name`, enter a name for your policy, such as DynamoDBFineGrainedAccessPolicy.
- Choose `Create policy`.

3. Attach the Policy to the Role
   - In the navigation pane, choose `Roles`.
   - Choose the role that you created in the previous step.
   - On the `Permissions` tab, choose `Attach policies`.
   - In the `Filter policies` search box, enter the policy name you created before.
   - Select the check box for your policy, then choose `Attach policy`.

**Note**: Fine-grained access control is a powerful feature but can be complex to configure. Be sure to test your setup to ensure it works as expected thoroughly.

## Expected Result

Fine-Grained Access Control policies are in place restricting DynamoDB access at the row level based on user identity.

## Remediation

### Using AWS Console

Follow the same steps as the audit procedure to create IAM roles and policies for Fine-Grained Access Control.

## Default Value

By default, Fine-Grained Access Control is not implemented. IAM policies grant table-level access.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |

## Profile

Level 1 | Manual
