---
name: cis-aws-euc-5.2
description: "Ensure a VPC Endpoint is set for AppStream"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, appstream, vpc-endpoint, network-security]
cis_id: "5.2"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: [CWE-668]
chains_with: [cis-aws-euc-5.1]
prerequisites: [cis-aws-euc-5.1]
severity_boost: {}
---

# Ensure a VPC Endpoint is set for AppStream (Manual)

## Profile Applicability

- Level 1

## Description

When you select Using a VPC endpoint, this allows users to only stream from this AppStream 2.0 stack when they have network access to the VPC.

## Rationale

Virtual Private Cloud (VPC) endpoints allow your users to stream from AppStream 2.0 through your VPC. You can create a VPC endpoint in the VPC of your choosing, then use the endpoint with AppStream 2.0 VPC to maintain the streaming traffic within the VPC.

## Impact

None - this is a security best practice.

## Audit Procedure

Perform the steps to review the interface endpoint set for AppStream 2.0.

### Using AWS Console

1. Log in to the AppStream 2.0 console at `https://console.aws.amazon.com/appstream2`
2. In the left pane, click **Stacks**, click the link for the stack you wish to view
3. Scroll to the **VPC Endpoints** section
4. Confirm the Streaming Endpoint listed is the endpoint through which to stream traffic

If there is no Streaming endpoint pointing to a specific VPC Endpoint and it is labeled as Internet refer to the remediation below.

### Using AWS CLI

Not applicable - must be audited via Console.

## Expected Result

AppStream stack has a VPC Endpoint configured for streaming traffic.

## Remediation

### Using AWS Console

Perform the following steps to create an interface endpoint:

1. Log in to the VPC console at `https://console.aws.amazon.com/vpc/`
2. In the left pane, click **Endpoints**, **Create Endpoint**
3. Click **Create Endpoint**
4. Configure the endpoint:
   - For Service category, ensure that **AWS services** is selected
   - For Service Name, choose `com.amazonaws.<AWS Region>.appstream.streaming`
   - For VPC, choose a VPC in which to create the interface endpoint
   - For Subnets, choose the subnet (Availability Zone) in which to create the endpoint network interfaces
   - Ensure that the **Enable Private DNS Name** check box is selected
   - For Security group, select the security group for AppStream
5. Click **Create endpoint**

**To update a stack to use a new interface endpoint:**

1. Log in to AppStream 2.0 console at `https://console.aws.amazon.com/appstream2`
2. In the left pane, click **Stacks**, and click the link of the stack name wish to edit
3. Scroll to the **VPC Endpoints**, and then choose **Edit**
4. In the Edit VPC Endpoint dialog box, for Streaming Endpoint, choose the endpoint you just created
5. Click **Save Changes**

Traffic for new streaming sessions will be routed through this endpoint. However, traffic for current streaming sessions continues to be routed through the previously specified endpoint.

### Using AWS CLI

Not applicable - must be configured via Console.

## Default Value

By default, VPC endpoints must be manually configured.

## References

1. https://docs.aws.amazon.com/appstream2/latest/developerguide/creating-streaming-from-interface-vpc-endpoints.html

## CIS Controls

**v8:**
- 3.12 Segment Data Processing and Storage Based on Sensitivity
  - Segment data processing and storage based on the sensitivity of the data. Do not process sensitive data on enterprise assets intended for lower sensitivity data.

**v7:**
- 14.1 Segment the Network Based on Sensitivity
  - Segment the network based on the label or classification level of the information stored on the servers, locate all sensitive information on separated Virtual Local Area Networks (VLANs).

## Profile

Level 1
