---
name: cis-aws-foundations-4.3
description: "Ensure AWS Config is enabled in all regions"
category: cis-logging
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, logging, config, configuration-management, compliance]
cis_id: "4.3"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-4.1]
prerequisites: []
severity_boost: {}
---

# Ensure AWS Config is enabled in all regions

## Description

AWS Config is a web service that performs configuration management of supported AWS resources within your account and delivers log files to you. The recorded information includes the configuration items (AWS resources), relationships between configuration items (AWS resources), and any configuration changes between resources. It is recommended that AWS Config be enabled in all regions. In environments using AWS Control Tower or Landing Zone Accelerator (LZA), AWS Config may be centrally managed and automatically enabled across regions.

## Rationale

The AWS configuration item history captured by AWS Config enables security analysis, resource change tracking, and compliance auditing.

## Impact

Enabling AWS Config in all regions provides comprehensive visibility into resource configurations, enhancing security and compliance monitoring. However, this may incur additional costs and require proper configuration management.

## Audit Procedure

### Using AWS Console

1. Sign in to the AWS Management Console and open the AWS Config console at https://console.aws.amazon.com/config/.
2. On the top right of the console select the target region.
3. If a Config Recorder is enabled in this region, you should navigate to the Settings page from the navigation menu on the left-hand side. If a Config Recorder is not yet enabled in this region, proceed to the remediation steps.
4. Ensure "Record all resources supported in this region" is checked.
5. Ensure "Include global resources (e.g., AWS IAM resources)" is checked, unless it is enabled in another region (this is only required in one region).
6. Ensure the correct S3 bucket has been defined.
7. Ensure the correct SNS topic has been defined.
8. Repeat steps 2 to 7 for each region.

Note: In environments using AWS Control Tower or Landing Zone Accelerator (LZA), AWS Config configuration may be managed centrally. Verify that AWS Config is enabled and recording through the centralized governance solution.

### Using AWS CLI

1. Run this command to show all AWS Config Recorders and their properties:

```bash
aws configservice describe-configuration-recorders
```

2. Evaluate the output to ensure that all recorders have a `recordingGroup` object which includes `"allSupported": true`. Additionally, ensure that at least one recorder has `"includeGlobalResourceTypes": true`.

**Note:** There is one more parameter, "ResourceTypes," in the recordingGroup object. We don't need to check it, as whenever we set "allSupported" to true, AWS enforces the resource types to be empty ("ResourceTypes": []).

Sample output:

```json
{
  "ConfigurationRecorders": [
    {
      "recordingGroup": {
        "allSupported": true,
        "resourceTypes": [],
        "includeGlobalResourceTypes": true
      },
      "roleARN": "arn:aws:iam::<AWS_Account_ID>:role/service-role/<config-role-name>",
      "name": "default"
    }
  ]
}
```

3. Run this command to show the status for all AWS Config Recorders:

```bash
aws configservice describe-configuration-recorder-status
```

4. In the output, find recorders with `name` key matching the recorders that were evaluated in step 2. Ensure that they include `"recording": true` and `"lastStatus": "SUCCESS"`.

## Expected Result

All regions have AWS Config enabled with `allSupported` set to `true`, at least one recorder has `includeGlobalResourceTypes` set to `true`, and all recorders show `recording: true` with `lastStatus: SUCCESS`.

## Remediation

### Using AWS Console

1. Select the region you want to focus on in the top right of the console.
2. Click `Services`.
3. Click `Config`.
4. If a Config Recorder is enabled in this region, navigate to the Settings page from the navigation menu on the left-hand side. If a Config Recorder is not yet enabled in this region, select "Get Started".
5. Select "Record all resources supported in this region".
6. Choose to include global resources (IAM resources).
7. Specify an S3 bucket in the same account or in another managed AWS account.
8. Create an SNS Topic from the same AWS account or another managed AWS account.

Note: In AWS Control Tower or Landing Zone Accelerator (LZA) environments, AWS Config setup and recording may be deployed and managed automatically. Configuration changes should be performed through the centralized governance framework rather than directly in individual accounts.

### Using AWS CLI

1. Ensure there is an appropriate S3 bucket, SNS topic, and IAM role per the AWS Config Service prerequisites.
2. Run this command to create a new configuration recorder:

```bash
aws configservice put-configuration-recorder --configuration-recorder name=<config-recorder-name>,roleARN=arn:aws:iam::<account-id>:role/<iam-role> --recording-group allSupported=true,includeGlobalResourceTypes=true
```

3. Create a delivery channel configuration file locally which specifies the channel attributes, populated from the prerequisites set up previously:

```json
{
  "name": "<delivery-channel-name>",
  "s3BucketName": "<bucket-name>",
  "snsTopicARN": "arn:aws:sns:<region>:<account-id>:<sns-topic>",
  "configSnapshotDeliveryProperties": {
    "deliveryFrequency": "Twelve_Hours"
  }
}
```

4. Run this command to create a new delivery channel, referencing the json configuration file made in the previous step:

```bash
aws configservice put-delivery-channel --delivery-channel file://<delivery-channel-file>.json
```

5. Start the configuration recorder by running the following command:

```bash
aws configservice start-configuration-recorder --configuration-recorder-name <config-recorder-name>
```

## Default Value

By default, AWS Config is not enabled in any region. No configuration changes or resource relationships are tracked until a Config Recorder and Delivery Channel are set up, leaving organizations without historical records for security analysis, compliance auditing, or incident investigations.

## References

1. CCE-78917-2
2. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/configservice/describe-configuration-recorder-status.html
3. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/configservice/describe-configuration-recorders.html
4. https://docs.aws.amazon.com/config/latest/developerguide/gs-cli-prereq.html

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 1.1 Establish and Maintain Detailed Enterprise Asset Inventory - Establish and maintain an accurate, detailed, and up-to-date inventory of all enterprise assets with the potential to store or process data. | x    | x    | x    |
| v7               | 1.4 Maintain Detailed Asset Inventory - Maintain an accurate and up-to-date inventory of all technology assets with the potential to store or process information.                                            | x    | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics                                | Mitigations |
| --------------------------- | -------------------------------------- | ----------- |
|                             | TA0003, TA0007, TA0008, TA0009, TA0042 | M1047       |

## Profile

Level 2 | Automated
