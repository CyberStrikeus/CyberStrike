---
name: cis-aws-compute-12.2
description: "Ensure Cloudwatch Lambda insights is enabled"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, lambda, serverless, cloudwatch, monitoring, insights]
cis_id: "12.2"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-12.1, cis-aws-compute-12.7]
prerequisites: []
severity_boost: {}
---

# Ensure Cloudwatch Lambda insights is enabled

## Description
Ensure that Amazon CloudWatch Lambda Insights is enabled for your Amazon Lambda functions for enhanced monitoring.

## Rationale
Amazon CloudWatch Lambda Insights allows you to monitor, troubleshoot, and optimize your Lambda functions. The service collects system-level metrics and summarizes diagnostic information to help you identify issues with your Lambda functions and resolve them as soon as possible. CloudWatch Lambda Insights collects system-level metrics and emits a single performance log event for every invocation of that Lambda function.

## Impact
Enabling CloudWatch Lambda Insights may incur additional CloudWatch costs. When you enable the feature using the AWS Management Console, Amazon Lambda adds the required permissions to your function's execution role.

## Audit Procedure

### Using AWS Console
1. Login to AWS Console using https://console.aws.amazon.com/lambda/
2. Click `Functions`.
3. Click on the name of the function.
4. Click on the `Configuration tab`.
5. Click on 'Monitoring and operations tools'.
6. In the Monitoring and operations tools section check the `Enhanced monitoring`.
7. If set to Not enabled, refer to the remediation below.
8. Repeat steps 2-7 for each Lambda function within the current region.
9. Then repeat the Audit process for all other regions.

### Using AWS CLI
1. Run `aws lambda list-functions`

```bash
aws lambda list-functions --output table --query "Functions[*].FunctionName"
```

This command will provide a table titled ListFunction

2. Run `aws lambda get-function`

```bash
aws lambda get-function --function-name "name_of_function" --query "'Configuration.Layers[*].Arn"
```

This command should provide the requested ARN.

3. If the list of ARNs does not contain the CloudWatch Lambda Insights extension ARN, i.e. `arn:aws:lambda:<aws-region>:12345678910:layer:LambdaInsightsExtension:<version>`, the Enhanced Monitoring feature is not enabled. Refer to the remediation below.

## Expected Result
Each Lambda function should have the CloudWatch Lambda Insights extension ARN listed in its layers, indicating Enhanced Monitoring is enabled.

## Remediation

### Using AWS Console
1. Login to AWS Console using https://console.aws.amazon.com/lambda/
2. Click `Functions`.
3. Click on the name of the function.
4. Click on the `Configuration tab`
5. Click on 'Monitoring and operations tools'.
6. In the Monitoring and operations tools section click `Edit` to update the monitoring configuration
7. In the CloudWatch Lambda Insights section click the `Enhanced monitoring` button to enable.
   ***Note - When you enable the feature using the AWS Management Console, Amazon Lambda adds the required permissions to your function's execution role.
8. Click Save
9. Repeat steps 2-8 for each Lambda function within the current region that fails the Audit.
10. Then repeat the Audit process for all other regions.

### Using AWS CLI
N/A - This control is Console-based remediation only.

## Default Value
CloudWatch Lambda Insights is not enabled by default.

## References
1. https://docs.aws.amazon.com/lambda/latest/dg/welcome.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 8.2 Collect Audit Logs - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets. | x | x | x |
| v7 | 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices. | x | x | x |

## Profile
Level 1 | Manual
