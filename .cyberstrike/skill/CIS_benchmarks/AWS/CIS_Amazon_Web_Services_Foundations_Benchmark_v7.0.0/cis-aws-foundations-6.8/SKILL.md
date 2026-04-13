---
name: cis-aws-foundations-6.8
description: "Ensure VPC Endpoints are used for access to AWS Services"
category: cis-networking
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, networking, vpc, vpc-endpoints, privatelink, s3, dynamodb]
cis_id: "6.8"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-6.5, cis-aws-foundations-6.6]
prerequisites: []
severity_boost: {}
---

# Ensure VPC Endpoints are used for access to AWS Services

## Description
Ensure that Amazon VPCs use VPC endpoints (gateway or interface endpoints) for access to AWS services such as Amazon S3 and DynamoDB, so that traffic from workloads to AWS services stays on the Amazon private network instead of traversing the public internet. VPC endpoints provide private connectivity between VPCs and supported AWS services without requiring an internet gateway, NAT gateway, or public IP addresses.

## Rationale
Accessing AWS services over the public internet increases exposure to network-level threats, relies on internet routing, and makes it harder to tightly control egress paths. Using VPC endpoints allows workloads to reach AWS services over the Amazon private network, which reduces reliance on internet gateways and NAT gateways, simplifies egress filtering, and helps enforce data-perimeter and "private-only" patterns for sensitive workloads.

## Impact
Enforcing the use of VPC endpoints may require changes to existing network architectures, including creating and managing endpoints in each VPC, updating route tables, adjusting security groups, and potentially removing or tightening some internet/NAT gateway paths. This can introduce additional operational overhead and cost (per-endpoint charges for interface endpoints) and may require updates to IaC templates and deployment pipelines.

## Audit Procedure

### Using AWS CLI

1. Identify in-scope VPCs and services.
   - Determine which VPCs host production or sensitive workloads that should access AWS services securely via endpoints.
   - For those VPCs, identify the AWS services they depend on (for example, S3 for data storage, DynamoDB for database, etc.).

2. For each in-scope VPC, check for existing VPC endpoints:

```bash
aws ec2 describe-vpc-endpoints \
  --region REGION \
  --filters "Name=vpc-id,Values=VPC_ID" \
  --query "VpcEndpoints[*].[VpcEndpointId,VpcEndpointType,ServiceName,State]" \
  --output table
```

   - Provide the REGION and VPC_ID.
   - `VpcEndpointType` tells you whether the endpoint is Gateway or Interface.
   - `ServiceName` shows which AWS service the endpoint is for (for example, com.amazonaws.us-east-1.s3, com.amazonaws.us-east-1.dynamodb, com.amazonaws.us-east-1.ssm).

3. For each interface endpoint, verify subnet attachment across relevant AZs/subnets:

```bash
aws ec2 describe-vpc-endpoints \
  --region REGION \
  --vpc-endpoint-ids INTERFACE_ENDPOINT_ID \
  --query "VpcEndpoints[*].[VpcEndpointId,ServiceName,SubnetIds,State]" \
  --output json
```

   - Provide the REGION and INTERFACE_ENDPOINT_ID.

4. For each gateway endpoint, verify that the route tables for the relevant subnets send traffic to the endpoint (via the AWS-managed prefix list), not via internet/NAT gateways.

   - Identify relevant subnets in the VPC that need to have a route to gateway endpoint:

```bash
aws ec2 describe-subnets \
  --region REGION \
  --filters "Name=vpc-id,Values=,VPC_ID" \
  --query "Subnets[*].[SubnetId,AvailabilityZone,MapPublicIpOnLaunch,CidrBlock]" \
  --output table
```

   - Provide the REGION and VPC_ID.
   - For each relevant subnet, identify the route table associated with it:

```bash
aws ec2 describe-route-tables \
  --region REGION \
  --filters "Name=association.subnet-id,Values=SUBNET_ID" \
  --query "RouteTables[*].RouteTableId" \
  --output text
```

   - Provide the REGION and SUBNET_ID.
   - For each route table associated with relevant subnets, inspect routes:

```bash
aws ec2 describe-route-tables \
  --region REGION \
  --route-table-ids ROUTE_TABLE_ID \
  --query "RouteTables[0].Routes[*].[DestinationPrefixListId,GatewayId,NatGatewayId,State]" \
  --output table
```

   - Provide the REGION and ROUTE_TABLE_ID.

For S3/DynamoDB gateway endpoints, you should see a DestinationPrefixListId (for example, pl-xxxxxxxx) with GatewayId equal to the endpoint (vpce-xxxx). If S3/DynamoDB are used by workloads in those subnets but traffic is only routed via igw-xxxx or nat-xxxx (and no prefix-list/endpoint route exists), then VPC endpoints are not being used for securing network traffic for these services.

## Expected Result
Each in-scope VPC should have VPC endpoints configured for the AWS services it depends on, with gateway endpoints having proper route table entries and interface endpoints attached to the relevant subnets.

## Remediation

### Using AWS CLI

In this example, we are going to add S3 gateway endpoint and SQS interface endpoint to a VPC. You can follow similar remediation instructions for other services.

1. Create S3 Gateway Endpoint:

```bash
aws ec2 create-vpc-endpoint \
  --region REGION \
  --route-table-ids ROUTE_TABLE_ID \
  --vpc-id VPC_ID \
  --service-name com.amazonaws.REGION.s3 \
  --vpc-endpoint-type Gateway \
  --query "VpcEndpoint.VpcEndpointId" \
  --output text
```

   - Provide values for REGION, ROUTE_TABLE_ID, VPC_ID.
   - AWS automatically creates the routes for the AWS service in the route table provided as part of above command.

2. Verify that the gateway routes have been adequately created:

```bash
aws ec2 describe-route-tables \
  --region REGION --route-table-ids ROUTE_TABLE_ID \
  --query "RouteTables[0].Routes[?DestinationPrefixListId=='pl-xxxxxxxx']"
```

   - Provide values for REGION, ROUTE_TABLE_ID.
   - pl-xxxxxxxx: replace with the specific prefix list for S3 in that region.

3. Create an SQS Interface Endpoint:

```bash
aws ec2 create-vpc-endpoint \
  --vpc-id VPC_ID \
  --service-name com.amazonaws.REGION.sqs \
  --vpc-endpoint-type Interface \
  --subnet-ids PRIVATE_SUBNET_1_ID PRIVATE_SUBNET_2_ID \
  --security-group-ids SECURITY_GROUP_ID \
  --vpc-endpoint-policy VPC_ENDPOINT_POLICY \
  --query "VpcEndpoint.VpcEndpointId" \
  --output text
```

   - SECURITY_GROUP_ID: Update security groups for interface endpoint. Ensure the interface endpoint security group allows inbound traffic from your workloads.
   - VPC_ENDPOINT_POLICY: Create a restrictive Endpoint policy to ensure only certain AWS services could be reached and only specific actions can be performed.
   - AWS automatically creates Elastic Network Interfaces (ENIs) for the interface endpoint which allows any traffic from PRIVATE_SUBNET_1_ID and PRIVATE_SUBNET_2_ID intended for SQS to be routed through the Interface Gateway.

4. Test and validate endpoint connectivity from an EC2 instance in a private subnet:

   - Test S3 (gateway endpoint):

```bash
aws s3 ls s3://your-test-bucket --region REGION
```

   - Test SQS (interface endpoint):

```bash
aws sqs list-queues --region REGION
```

## Default Value
By default, VPC endpoints are not created. Traffic to AWS services is routed over the public internet via internet gateways or NAT gateways unless VPC endpoints are explicitly configured.

## References
None specified in the benchmark.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 12.2 Establish and Maintain a Secure Network Architecture | | x | x |

## Profile
Level 2 | Manual
