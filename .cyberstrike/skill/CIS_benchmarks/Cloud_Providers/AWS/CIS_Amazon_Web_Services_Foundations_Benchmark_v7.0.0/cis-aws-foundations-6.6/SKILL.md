---
name: cis-aws-foundations-6.6
description: "Ensure routing tables for VPC peering are least access"
category: cis-networking
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, networking, vpc, vpc-peering, route-tables]
cis_id: "6.6"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-6.5, cis-aws-foundations-6.8]
prerequisites: []
severity_boost: {}
---

# Ensure routing tables for VPC peering are "least access"

## Description

Once a VPC peering connection is established, routing tables must be updated to enable any connections between the peered VPCs. These routes can be as specific as desired, even allowing for the peering of a VPC to only a single host on the other side of the connection.

It is recommended that a metric filter and alarm be established for changes made to VPCs.

## Rationale

Being highly selective in peering routing tables is a very effective way to minimize the impact of a breach, as resources outside of these routes are inaccessible to the peered VPC.

## Impact

None specified.

## Audit Procedure

### Using AWS Console

Review the routing tables of peered VPCs to determine whether they route all subnets of each VPC and whether this is necessary to accomplish the intended purposes of peering the VPCs.

### Using AWS CLI

1. List all the route tables from a VPC and check if the "GatewayId" is pointing to a `<peering-connection-id>` (e.g., pcx-1a2b3c4d) and if the "DestinationCidrBlock" is as specific as desired:

```bash
aws ec2 describe-route-tables --filter "Name=vpc-id,Values=<vpc-id>" --query "RouteTables[*].{RouteTableId:RouteTableId, VpcId:VpcId, Routes:Routes, AssociatedSubnets:Associations[*].SubnetId}"
```

2. Alternatively, the following command can be used for improved readability:

```bash
aws ec2 describe-route-tables --query "RouteTables[].{RouteTableId:RouteTableId, VpcId:VpcId, Routes:Routes, AssociatedSubnets:Associations[].SubnetId}" --output table
```

## Expected Result

Routing tables for VPC peering connections should have the most specific CIDR blocks possible, routing only the minimum required subnets or hosts -- not entire VPC CIDR ranges.

## Remediation

### Using AWS Console

Review route table entries and remove overly permissive routes to peered VPCs, replacing them with specific routes to only the required subnets or hosts.

### Using AWS CLI

1. For each `<route-table-id>` that contains routes that are non-compliant with your routing policy (granting more access than desired), delete the non-compliant route:

```bash
aws ec2 delete-route --route-table-id <route-table-id> --destination-cidr-block <non-compliant-destination-cidr>
```

2. Create a new compliant route:

```bash
aws ec2 create-route --route-table-id <route-table-id> --destination-cidr-block <compliant-destination-cidr> --vpc-peering-connection-id <peering-connection-id>
```

## Default Value

By default, AWS allows full routing between peered VPCs once routes are added. There is no automatic restriction to "least access" -- administrators must manually scope routes to the minimum required CIDR blocks or hosts.

## References

1. https://docs.aws.amazon.com/AmazonVPC/latest/PeeringGuide/peering-configurations-partial-access.html
2. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/create-vpc-peering-connection.html

## Additional Information

If an organization has an AWS Transit Gateway implemented in its VPC architecture, it should look to apply the recommendation above for a "least access" routing architecture at the AWS Transit Gateway level, in combination with what must be implemented at the standard VPC route table. More specifically, to route traffic between two or more VPCs via a Transit Gateway, VPCs must have an attachment to a Transit Gateway route table as well as a route. Therefore, to avoid routing traffic between VPCs, an attachment to the Transit Gateway route table should only be added where there is an intention to route traffic between the VPCs. As Transit Gateways are capable of hosting multiple route tables, it is possible to group VPCs by attaching them to a common route table.

## CIS Controls

| Controls Version | Control                                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 13.4 Perform Traffic Filtering Between Network Segments            |      | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running |      | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1210                       | TA0008  | M1030       |

## Profile

Level 2 | Manual
