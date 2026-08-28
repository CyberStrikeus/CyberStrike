---
name: cis-aws-compute-2.13
description: "Ensure Secrets and Sensitive Data are not stored directly in EC2 User Data"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ec2, user-data, secrets, sensitive-data, secrets-manager]
cis_id: "2.13"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-2.8]
prerequisites: []
severity_boost: {}
---

# Ensure Secrets and Sensitive Data are not stored directly in EC2 User Data

## Description

User Data can be specified when launching an ec2 instance. Examples include specifying parameters for configuring the instance or including a simple script.

## Rationale

The user data is not protected by authentication or cryptographic methods. Therefore, sensitive data, such as passwords or long-lived encryption keys should not be stored as user data.

## Impact

Anyone who has access to the instance and configuration can view the user data. Removing secrets from user data may require changes to instance bootstrapping processes.

## Audit Procedure

### Using AWS CLI

1. Run `aws ec2 describe-instances` to retrieve information about all instances in the AWS region. The output will include instance ids.

2. Run `aws ec2 describe-instance-attribute` for each instance in AWS account:

```bash
aws ec2 describe-instance-attribute --instance-id "ID of instance" --attribute userData
```

Note: User Data may be Base64 encoded. Decode the output as necessary.

3. Review user data to ensure no secrets or sensitive information are stored.
4. Repeat the Audit for all the other AWS regions.

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services` and click `EC2` under Compute.
3. Click on `Instances`.
4. For each instance, click `Actions` -> `Instance Settings` -> `Edit user data`.
5. For each instance, review the user data to ensure there are no secrets or sensitive data stored.
6. If secrets or sensitive data is found, refer to the remediation below.
7. Repeat steps 2-7 for all regions used.

## Expected Result

No EC2 instance user data should contain secrets, passwords, API keys, or other sensitive information. User data should only contain non-sensitive configuration parameters or scripts that retrieve secrets from a secure source like AWS Secrets Manager.

## Remediation

### Using AWS CLI

No specific CLI remediation command is provided for this control. Use the console method below.

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services` and click `EC2` under Compute.
3. Click on `Instances`.
4. If the instance is currently running, stop the instance first.

Note: ensure there is no negative impact from stopping the instance prior to stopping the instance.

5. For each instance, click `Actions` -> `Instance Settings` -> `Edit user data`.
6. For each instance, edit the user data to ensure there are no secrets or sensitive data stored. A Secret Management solution such as AWS Secrets Manager can be used here as a more secure mechanism of storing necessary sensitive data.
7. Repeat this remediation for all the other AWS regions.

Note: If the ec2 instances are created via automation or infrastructure-as-code, edit the user data in those pipelines and code.

## Default Value

EC2 user data is empty by default unless specified during instance launch.

## References

1. https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-metadata.html

## CIS Controls

| Controls Version | Control                                     | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.2 Establish and Maintain a Data Inventory | x    | x    | x    |
| v8               | 3.3 Configure Data Access Control Lists     | x    | x    | x    |
| v7               | 1.5 Maintain Asset Inventory Information    |      | x    | x    |

## Profile

Level 1 | Manual
