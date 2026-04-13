---
name: cis-aws-database-4.6
description: "Ensure DynamoDB Streams and AWS Lambda for Automated Compliance Checking is Enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, dynamodb, streams, lambda, compliance, automation]
cis_id: "4.6"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-4.7]
prerequisites: []
severity_boost: {}
---

# 4.6 Ensure DynamoDB Streams and AWS Lambda for Automated Compliance Checking is Enabled

## Description
Enabling DynamoDB Streams and integrating AWS Lambda allows you to automate compliance checking and perform actions based on changes made to your DynamoDB data.

## Rationale
Enabling the DynamoDB with AWS Lambda allows the individual to either use an existing or create a new execution role that allows Lambda to access DynamoDB and write logs.

## Impact
N/A

## Audit Procedure

### Using AWS Console
1. Open DynamoDB Console
   - Sign in to the AWS Management Console and open the DynamoDB console at https://console.aws.amazon.com/dynamodb/.

2. Create or Select a DynamoDB Table
   - You can create a new DynamoDB table or select an existing one to enable DynamoDB Streams.

3. Enable DynamoDB Streams
   - In the DynamoDB console, select your table.
   - Click on the `Overview` tab.
   - Under the `DynamoDB Streams` section, click on `Manage stream`.
   - In the `Manage stream` dialog, choose `Enable` and select the desired view type (e.g., `New and old images`).
   - Click `Enable`.

4. Create an AWS Lambda Function
   - Open the AWS Management Console and navigate to the Lambda service at https://console.aws.amazon.com/lambda/.
   - Click `Create function` to create a new Lambda function.
   - Choose a function name, runtime (e.g., Node.js, Python), and other basic settings.
   - Under `Permissions`, choose an existing or create a new execution role that allows Lambda to access DynamoDB and write logs.
   - Click `Create function` to create the Lambda function.

5. Configure AWS Lambda with DynamoDB Stream
   - Scroll down to the `Designer` section in the Lambda function editor.
   - Click on `Add trigger`.
   - Select `DynamoDB` from the trigger list.
   - In the `Configure triggers` dialog, choose the DynamoDB table and the stream that you enabled in the previous step.
   - Define the batch size and starting position, if applicable.
   - Click "Add".

6. Write Lambda Function Code for Compliance Checking
   - In the Lambda function editor, scroll up to the code editor section.
   - Write your compliance-checking logic in the selected runtime language (e.g., Node.js, Python).
   - The code should handle the incoming DynamoDB stream records and perform the necessary compliance checks.
   - If needed, you can use the AWS SDKs or other libraries to interact with DynamoDB or other AWS services.

7. Configure Lambda Function Settings
   - Scroll down to the `Function overview` section.
   - Configure the memory, timeout, and other settings as per your requirements.
   - Click `Save` to save the Lambda function.

8. Test the Compliance Checking
   - You can test the compliance checking by changing the DynamoDB table and observing the Lambda function's behavior through the CloudWatch logs or other desired actions performed by the function.

## Expected Result
DynamoDB Streams are enabled and an AWS Lambda function is configured to process stream records for automated compliance checking.

## Remediation

### Using AWS Console
Follow the same steps as the audit procedure to enable DynamoDB Streams and create a Lambda function for automated compliance checking.

## Default Value
By default, DynamoDB Streams are not enabled and no Lambda triggers are configured.

## References
1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3 Data Protection | | | |
| v7 | 13 Data Protection | | | |

## Profile
Level 1 | Manual
