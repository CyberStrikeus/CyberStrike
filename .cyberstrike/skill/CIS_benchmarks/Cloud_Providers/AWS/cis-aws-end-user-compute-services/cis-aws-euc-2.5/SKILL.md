---
name: cis-aws-euc-2.5
description: "Ensure WorkSpaces traffic is controlled and routed through a NAT Gateway"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, workspaces, nat-gateway, routing, network-traffic]
cis_id: "2.5"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-euc-2.4, cis-aws-euc-2.6]
prerequisites: []
severity_boost: {}
---

# Ensure WorkSpaces traffic is controlled and routed through a NAT Gateway (Manual)

## Profile Applicability

- Level 1

## Description

A network address translation (NAT) gateway enables instances in a private subnet to connect to the internet or other AWS services, but prevents the internet from initiating a direct connection with those instances.

## Rationale

WorkSpaces must have access to the internet so that you can install updates to the operating system and deploy applications.

## Impact

None specified in the benchmark.

## Audit Procedure

### Using AWS Console

Perform the following steps to verify a NAT Gateway is configured and utilized:

1. Login to the VPC console at https://console.aws.amazon.com/vpc/
2. In the left pane, click **Route Tables**
3. On the Route Table tab
4. Select the public route table set for WorkSpaces
5. Click the **Subnet Associations** Tab
6. Confirm that the Subnet ID is set to the WorkSpaces Public subnet
7. De-select the public route table and select the WorkSpaces Private route table
8. Click the **Subnet Associations** Tab
9. Confirm that the Subnet ID is set to the 2 WorkSpaces Private subnet

If the Route tables aren't set for one route for local traffic and another route that sends all other traffic to the internet gateway for the VPC refer to the remediation procedure below.

## Remediation

### Using AWS Console

Perform the following steps to create a NAT gateway:

1. Login to the VPC console at https://console.aws.amazon.com/vpc/
2. In the left pane, click **NAT Gateways**
3. Click **Create NAT Gateway**
4. For NAT Gateway settings:
   - Name - although optional use something to identify it with WorkSpaces
   - Specify the subnet in which to create the NAT gateway
   - Select the Elastic IP Allocation ID

5. Click **Create a NAT Gateway**

The NAT gateway will display in the console and after a few moments, its status will change to Available.

If the NAT gateway goes to a status of Failed, there was an error during creation.

After you've created your NAT gateway, you must update your route tables for your private subnets to point internet traffic to the NAT gateway.

**To create a route for a NAT gateway:**

1. Log in to the VPC console at https://console.aws.amazon.com/vpc/
2. In the left pane, Click **Route Tables**
3. Select the route table associated with your private subnet
4. Click **Routes** tab
5. Click **Edit routes**
6. Click **Add route**
7. For Edit routes:
   - Destination, enter 0.0.0.0/0
   - Target, select the ID of your NAT gateway

8. Click **Save routes**

## Default Value

By default, No NAT Gateways are created for a VPC.

## References

1. https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html
2. https://docs.aws.amazon.com/workspaces/latest/adminguide/amazon-workspaces-vpc.html

## Additional Information

**Note:** In some multi-account AWS architectures organizations may choose to leverage a centralized internet egress pattern. This could be due to appliances running in the centralized pattern which are being used to enforce controls and could include DLP or category filtering on internet egress traffic. In this case the relevant audit procedure is ensuring the workspaces VPC has a route to the internet (either via proxy server configuration on the workspace instances themselves or the default route on the workspace instance VPC subnet)

## CIS Controls

**v8:**

- 3.12 Segment Data Processing and Storage Based on Sensitivity
  - Segment data processing and storage based on the sensitivity of the data. Do not process sensitive data on enterprise assets intended for lower sensitivity data.
- 13.4 Perform Traffic Filtering Between Network Segments
  - Perform traffic filtering between network segments, where appropriate.

**v7:**

- 14.1 Segment the Network Based on Sensitivity
  - Segment the network based on the label or classification level of the information stored on the servers, locate all sensitive information on separated Virtual Local Area Networks (VLANs).
- 14.2 Enable Firewall Filtering Between VLANs
  - Enable firewall filtering between VLANs to ensure that only authorized systems are able to communicate with other systems necessary to fulfill their specific responsibilities.
