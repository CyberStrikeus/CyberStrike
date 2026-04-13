---
name: cis-aws-foundations-3.1.3
description: "Ensure all data in Amazon S3 has been discovered, classified, and secured when necessary"
category: cis-storage
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, s3, macie, data-classification, data-discovery]
cis_id: "3.1.3"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-3.1.1, cis-aws-foundations-3.1.2, cis-aws-foundations-3.1.4]
prerequisites: []
severity_boost: {}
---

# Ensure all data in Amazon S3 has been discovered, classified, and secured when necessary

## Description
Amazon S3 buckets can contain sensitive data that, for security purposes, should be discovered, monitored, classified, and protected. Macie, along with other third-party tools, can automatically provide an inventory of Amazon S3 buckets.

## Rationale
Using a cloud service or third-party software to continuously monitor and automate the process of data discovery and classification for S3 buckets through machine learning and pattern matching is a strong defense in protecting that information.

Amazon Macie is a fully managed data security and privacy service that uses machine learning and pattern matching to discover and protect your sensitive data in AWS.

## Impact
There is a cost associated with using Amazon Macie, and there is typically a cost associated with third-party tools that perform similar processes and provide protection.

## Audit Procedure

### Using AWS Console
1. Login to the Macie console at https://console.aws.amazon.com/macie/.
2. In the left hand pane, click on `By job` under findings.
3. Confirm that you have a job set up for your S3 buckets.

When you log into the Macie console, if you are not taken to the summary page and do not have a job set up and running, then refer to the remediation procedure below.

If you are using a third-party tool to manage and protect your S3 data, you meet this recommendation.

### Using AWS CLI
No specific CLI audit procedure is provided for this control. Use the console to verify Macie configuration.

## Expected Result
Amazon Macie should be enabled and configured with discovery jobs for S3 buckets, or a third-party equivalent tool should be in use for data discovery and classification.

## Remediation

### Using AWS Console

**Enable Amazon Macie:**
1. Log on to the Macie console at https://console.aws.amazon.com/macie/.
2. Click `Get started`.
3. Click `Enable Macie`.

**Set up a repository for sensitive data discovery results:**
1. In the left pane, under Settings, click `Discovery results`.
2. Make sure `Create bucket` is selected.
3. Create a bucket and enter a name for it. The name must be unique across all S3 buckets, and it must start with a lowercase letter or a number.
4. Click `Advanced`.
5. For block all public access, make sure `Yes` is selected.
6. For KMS encryption, specify the AWS KMS key that you want to use to encrypt the results. The key must be a symmetric customer master key (CMK) that is in the same region as the S3 bucket.
7. Click `Save`.

**Create a job to discover sensitive data:**
1. In the left pane, click `S3 buckets`. Macie displays a list of all the S3 buckets for your account.
2. Check the box for each bucket that you want Macie to analyze as part of the job.
3. Click `Create job`.
4. Click `Quick create`.
5. For the Name and Description step, enter a name and, optionally, a description of the job.
6. Click `Next`.
7. For the Review and create step, click `Submit`.

**Review your findings:**
1. In the left pane, click `Findings`.
2. To view the details of a specific finding, choose any field other than the check box for the finding.

If you are using a third-party tool to manage and protect your S3 data, follow the vendor documentation for implementing and configuring that tool.

### Using AWS CLI
No specific CLI remediation procedure is provided for this control. Use the console to enable and configure Macie.

## Default Value
By default, Amazon S3 does not perform data discovery, classification, or monitoring. Services such as Amazon Macie or third-party tools must be explicitly enabled and configured.

## References
1. https://aws.amazon.com/macie/getting-started/
2. https://docs.aws.amazon.com/workspaces/latest/adminguide/data-protection.html
3. https://docs.aws.amazon.com/macie/latest/user/data-classification.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.1 Establish and Maintain a Data Management Process | x | x | x |
| v7 | 5.1 Establish Secure Configurations | x | x | x |

## Profile
Level 2 | Manual
