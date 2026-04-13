---
name: cis-aws-foundations-5.16
description: "Ensure AWS Security Hub is enabled"
category: cis-monitoring
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, monitoring, security-hub, compliance, security-posture]
cis_id: "5.16"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure AWS Security Hub is enabled

## Description
Security Hub collects security data from various AWS accounts, services, and supported third-party partner products, helping you analyze your security trends and identify the highest-priority security issues. When you enable Security Hub, it begins to consume, aggregate, organize, and prioritize findings from the AWS services that you have enabled, such as Amazon GuardDuty, Amazon Inspector, and Amazon Macie. You can also enable integrations with AWS partner security products.

## Rationale
AWS Security Hub provides you with a comprehensive view of your security state in AWS and helps you check your environment against security industry standards and best practices, enabling you to quickly assess the security posture across your AWS accounts.

## Impact
It is recommended that AWS Security Hub be enabled in all regions. AWS Security Hub requires that AWS Config be enabled.

## Audit Procedure

### From Console

1. Sign in to the AWS Management Console and open the AWS Security Hub console at https://console.aws.amazon.com/securityhub/.
2. On the top right of the console, select the target Region.
3. If the Security Hub > Summary page is displayed, then Security Hub is set up for the selected region.
4. If presented with "Setup Security Hub" or "Get Started With Security Hub," refer to the remediation steps.
5. Repeat steps 2 to 4 for each region.

### From Command Line

Run the following command to verify the Security Hub status:

```bash
aws securityhub describe-hub
```

This will list the Security Hub status by region. Check for a `SubscribedAt` value.

Example output:

```json
{
    "HubArn": "<security-hub-arn>",
    "SubscribedAt": "2022-08-19T17:06:42.398Z",
    "AutoEnableControls": true
}
```

An error will be returned if Security Hub is not enabled.

Example error:

```
An error occurred (InvalidAccessException) when calling the DescribeHub operation: Account <Account ID> is not subscribed to AWS Security Hub
```

## Expected Result
The `aws securityhub describe-hub` command returns a valid response with a `SubscribedAt` timestamp in each region, confirming that Security Hub is enabled and active.

## Remediation

### From Console

1. Use the credentials of the IAM identity to sign in to the Security Hub console.
2. When you open the Security Hub console for the first time, choose `Go to Security Hub`.
3. The `Security standards` section on the welcome page lists supported security standards. Check the box for a standard to enable it.
4. Choose `Enable Security Hub`.

### From Command Line

1. Run the `enable-security-hub` command, including `--enable-default-standards` to enable the default standards:

```bash
aws securityhub enable-security-hub --enable-default-standards
```

2. To enable Security Hub without the default standards, include `--no-enable-default-standards`:

```bash
aws securityhub enable-security-hub --no-enable-default-standards
```

## Default Value
By default, AWS Security Hub is not enabled. It must be manually set up in each region (and requires AWS Config) before findings can be aggregated or standards applied.

## References
1. https://docs.aws.amazon.com/securityhub/latest/userguide/securityhub-get-started.html
2. https://docs.aws.amazon.com/securityhub/latest/userguide/securityhub-enable.html#securityhub-enable-api
3. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/securityhub/enable-security-hub.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 7.1 Establish and Maintain a Vulnerability Management Process | x | x | x |
| v7 | 11.3 Use Automated Tools to Verify Standard Device Configurations and Detect Changes | | x | x |

## Profile
Level 2 | Automated
