---
name: cis-aws-euc-2.17
description: "Ensure WorkSpaces API requests flow through a VPC Endpoint"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, workspaces, vpc-endpoint, network-security]
cis_id: "2.17"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure WorkSpaces API requests flow through a VPC Endpoint (Automated)

## Description

For any WorkSpaces API requests setup the connection through an interface endpoint in your VPC.

## Rationale

Utilizing a VPC interface endpoint for WorkSpaces API requests keeps the communication within the AWS network.

## Impact

This feature can only be used for connecting to WorkSpaces API endpoints.

## Audit Procedure

### Using AWS CLI

Perform the steps to determine if WorkSpaces is using a VPC endpoint for API:

1. Run the WorkSpaces `describe-workspace-budles` command:

```bash
aws workspaces describe-workspace-bundles --endpoint-url
VPC_Endpoint_ID.workspaces.Region.vpce.amazonaws.com
```

2. Example output of that command:

```
--endpoint-name Endpoint_Name
--body "Endpoint_Body"
--content-type "Content_Type"
Output_File
```

Confirm the --endpoint-name is equal to the VPC Endpoint that you have created. If the endpoint name does not match what you created or is blank, refer to the remediation below.

### Expected Result

WorkSpaces API requests are routed through the configured VPC endpoint.

## Remediation

### Using AWS Console

Perform the steps below if you need to create a VPC interface endpoint.

1. Log in to the VPC console at https://console.aws.amazon.com/vpc/
2. In the left pane, click Endpoints
3. Click Create Endpoint.
4. For Service category, ensure that AWS services is selected.
5. For Service Name, choose Workspaces. For Type, ensure that it indicates Interface.
6. Complete the following information:
   - For VEC, select a VPC in which to create the endpoint.
   - For Subnets, select the subnets (Availability Zones) in which to create the endpoint network interfaces. Not all Availability Zones may be supported for all AWS services.
   - To enable private DNS for the interface endpoint, for Enable Private DNS Name, select the check box.
   - For Security group, select the security groups to associate with the endpoint network interfaces.
7. Click Create endpoint

### Using AWS CLI

1. Run the create-vpc-endpoint command:

```bash
aws ec2 create-vpc-endpoint --vpc-id vpc-ec43eb89 --vpc-endpoint-type
interface --service-name com.amazonaws.us-east-1.elasticloadbalancing --
subnet-id subnet-abababab --security-group-id sg-1a2b3c4d
```

In the output that's returned, take note of the DnsName fields. You can use these DNS names to access the AWS service.

**Next perform the steps to add the Endpoint to the WorkSpace image**

### Using AWS CLI

1. Run the copy-workspace-image command including the endpoint url you just created.

```bash
aws workspaces copy-workspace-image --endpoint-url
VPC_Endpoint_ID.workspaces.Region.vpce.amazonaws.com
```

## Default Value

By default, this feature is not enabled and must be configured in the VPC console.

## References

1. https://docs.aws.amazon.com/workspaces/latest/adminguide/infrastructure-security.html
2. https://docs.aws.amazon.com/vpc/latest/userguide/vpce-interface.html#create-interface-endpoint

## CIS Controls

**Controls Version v8:**

- 3.13 Deploy a Data Loss Prevention Solution

**Controls Version v7:**

- 13.3 Monitor and Block Unauthorized Network Traffic

## Profile

Level 1
