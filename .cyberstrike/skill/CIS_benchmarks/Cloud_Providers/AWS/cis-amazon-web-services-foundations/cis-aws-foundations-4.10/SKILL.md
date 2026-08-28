---
name: cis-aws-foundations-4.10
description: "Ensure all AWS-managed web front-end services have access logging enabled"
category: cis-logging
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, logging, cloudfront, alb, nlb, api-gateway, access-logging, web]
cis_id: "4.10"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-4.1, cis-aws-foundations-4.4]
prerequisites: []
severity_boost: {}
---

# Ensure all AWS-managed web front-end services have access logging enabled

## Description

Ensure that access logging is enabled for all AWS-managed web front-end services that terminate or front HTTP(S) traffic, including Amazon CloudFront distributions, Application Load Balancers (ALB), Network Load Balancers (NLB), and Amazon API Gateway REST/HTTP API stages with public endpoints. Access logs must be enabled with delivery to a designated S3 bucket or CloudWatch Logs destination that is protected with appropriate access controls.

This control requires logging of request details such as client IP address, timestamp, HTTP method, requested URI, response status code, bytes transferred, and user agent for every request processed by these services. CloudTrail provides management event logging for these resources, but access logs are required to capture the actual HTTP request/response activity at the network edge layers.

## Rationale

AWS-managed web front-end services (CloudFront, ALB/NLB, API Gateway) represent the primary HTTP(S) ingress points into AWS accounts and are the first line of defense against web attacks, reconnaissance, and abuse attempts. CloudTrail logs management actions (create/update/delete) and data events but does not capture the content of HTTP requests/responses or client activity, leaving a critical visibility gap for security monitoring and incident response.

Access logs from these services enable reconstruction of all web traffic, detection of anomalous patterns, forensic analysis of incidents, and compliance proof that internet-facing entry points were monitored. Without these logs, security teams cannot distinguish legitimate traffic from attacks or prove access patterns during audits.

## Impact

Enabling access logging incurs additional storage costs for log delivery and retention, as well as minor configuration overhead for creating dedicated logging buckets, IAM roles, and retention policies. Costs can be managed through lifecycle policies, log sampling, and tiered storage classes.

## Audit Procedure

### Using AWS Console

As an example with CloudFront, verify following the below steps if access logging is enabled:

1. Open the CloudFront console from the AWS Management Console.
2. Click Distributions in the left navigation.
3. For each Distribution ID (e.g., E123ABC...), click the Distribution ID and go to the "Logging" tab
4. Check if one or more "Access log destinations" are present with a destination type of S3 or CloudWatch log group.

### Using AWS CLI

N/A - This control requires checking multiple services (CloudFront, ALB, NLB, API Gateway) through their respective console interfaces or service-specific CLI commands.

## Expected Result

All AWS-managed web front-end services (CloudFront distributions, ALBs, NLBs, API Gateway stages) with public endpoints have access logging enabled and delivering logs to a designated S3 bucket or CloudWatch Logs destination.

## Remediation

### Using AWS Console

Following instructions enable standard access logging for CloudFront distributions using the AWS Management Console.

1. Open the CloudFront console from the AWS Management Console.
2. Click Distributions in the left navigation and click on the Distribution ID needing remediation.
3. Go to the "Logging" tab and click on "Create access log delivery"
   - Select "Deliver to" for your preferred location: S3 or CloudWatch log group
   - Select the ARN of your log destination resource
   - Click on Submit
4. Confirm if you see the access log destination in the logging tab

### Using AWS CLI

N/A - Remediation steps vary by service. Use the respective service console or service-specific CLI commands for ALB, NLB, and API Gateway access logging configuration.

## Default Value

By default, access logging is not enabled for CloudFront distributions, ALBs, NLBs, or API Gateway stages. Each service requires explicit configuration to enable access logging.

## References

N/A

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 8.2 Collect Audit Logs - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets.                                                                                                                        | x    | x    | x    |
| v8               | 8.5 Collect Detailed Audit Logs - Configure detailed audit logging for enterprise assets containing sensitive data. Include event source, date, username, timestamp, source addresses, destination addresses, and other useful elements that could assist in a forensic investigation. |      | x    | x    |
| v8               | 8.7 Collect URL Request Audit Logs - Collect URL request audit logs on enterprise assets, where appropriate and supported.                                                                                                                                                             |      | x    | x    |

## Profile

Level 1 | Manual
