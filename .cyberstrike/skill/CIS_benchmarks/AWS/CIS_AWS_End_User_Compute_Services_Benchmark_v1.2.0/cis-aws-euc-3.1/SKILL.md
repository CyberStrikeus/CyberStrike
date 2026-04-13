---
name: cis-aws-euc-3.1
description: "Ensure User Access Logging is enabled"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, workspaces-web, logging, audit]
cis_id: "3.1"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure User Access Logging is enabled (Manual)

## Description

User Access Logging can record the following user events:

- Session Start - when a WorkSpaces Web sessions begins.
- Session End - when a WorkSpaces Web session ends.
- URL Navigation - when a user loads a URL.

User Access logging can be setup to record user events.

## Rationale

Logging user activity will assist in event correlation if response to an incident is needed.

## Impact

None

## Audit Procedure

### Using AWS Console

1. Log in to the WorkSpaces console at https://console.aws.amazon.com/workspaces-web/
2. In the left pane, click Web portals.
3. Click the link for correspoinidng web portal.
4. Scroll to the User access logging section
5. Verify the Kinesis data stream arn is set.

If no Kinesis data streams are listed are defined then user access logging is not enabled.

### Using AWS CLI

1. From the command line run the list-user-access-logging-settings:

```bash
aws workspaces-web list-user-access-logging-settings --output table
```

2. The command should output a table with the listed settings.

If no settings are defined then user access logging is not enabled.

### Expected Result

A Kinesis data stream is configured for user access logging.

## Remediation

### Using AWS Console

1. Log in to the Amazon Kinesis console at https://console.aws.amazon.com/kinesis/home
2. In the left pane, click Data Streams then Create data stream.
3. Enter a name for your data stream. The name must be prefixed with amazon-workspaces-web
4. Select the desired data stream capacity and click Create data stream
5. Log into the Amazon WorkSpaces console at https://console.aws.amazon.com/workspaces/v2/home
6. In the left pane click Web Portals
7. Click the link for the web portal you wish to edit.
8. Click Edit
9. Scroll to User access logging and select the Kinesis data stream you created above.
10. Click Save

### Using AWS CLI

1. Run the create-user-access-logging-settings command:

```bash
aws workspaces-web create-user-access-logging-settings --kinesis-stream-arn
<kinesis_data_stream_arn>. --output table
```

2. The output will return a list of settings

## Default Value

By default, user access logging is not enabled.

## References

1. https://docs.aws.amazon.com/workspaces-web/latest/adminguide/data-protection-logging.html

## CIS Controls

This control does not have explicit CIS Controls mappings in the PDF.

## Profile

Level 1
