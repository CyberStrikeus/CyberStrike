---
name: cis-aws-database-7.1
description: "Ensure Network Architecture Planning"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, documentdb, network, vpc, architecture]
cis_id: "7.1"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-7.2, cis-aws-database-7.5]
prerequisites: []
severity_boost: {}
---

# 7.1 Ensure Network Architecture Planning (Manual)

## Description

Plan the network architecture to isolate your DocumentDB instances within a secure Virtual Private Cloud (VPC). Configure appropriate security groups and network access control lists (ACLs) to control inbound and outbound traffic to your DocumentDB instances.

## Rationale

Depending on how the network is established between devices, which then helps secure data when transferring it from one server to another.

## Impact

The way the users design their network sets the performance for the system and how it would interact with servers.

## Audit Procedure

### Using AWS Console

1. Understand Amazon VPC Basics
   - Familiarize yourself with Amazon Virtual Private Cloud (VPC) and its concepts.
   - Learn about VPC components, including subnets, route tables, and security groups.

2. Determine VPC Requirements for DocumentDB
   - Identify the specific networking requirements for your Amazon DocumentDB deployment.
   - Consider factors such as network availability, fault tolerance, and security requirements.

3. Create a New VPC or Use an Existing VPC
   - Decide whether to create a new VPC dedicated to Amazon DocumentDB or use an existing VPC.
   - If creating a new VPC, follow the steps to create a VPC in the AWS Management Console.

4. Configure Subnets
   - Determine the number and size of subnets needed for your DocumentDB deployment.
   - Create the required subnets within your VPC, ensuring proper availability zone distribution.

5. Set Up Routing
   - Configure the route tables associated with your subnets.
   - Ensure that the route tables have the necessary routes for proper network connectivity.

6. Configure Security Groups
   - Create or configure security groups to control inbound and outbound traffic to your DocumentDB instances.
   - Define the necessary inbound rules to allow access from authorized sources.

7. Plan Connectivity Options
   - Decide how your DocumentDB instances will connect to your VPC and other resources.
   - Determine if you need to set up VPC peering, VPN connections, or AWS Direct Connect for connectivity.

8. Consider High Availability and Fault Tolerance
   - Evaluate your requirements for high availability and fault tolerance.
   - Design your network architecture to ensure that DocumentDB instances are deployed across multiple availability zones for resilience.

9. Implement Network Access Control
   - Consider using network access control lists (ACLs) to provide an additional layer of security.
   - Configure the ACLs to allow only necessary traffic and block unauthorized access.

10. Test and Validate the Network Architecture
    - Ensure that your network architecture is correctly configured and meets your requirements.
    - Test connectivity and verify that DocumentDB instances can be accessed securely.

## Expected Result

DocumentDB instances are deployed within a properly planned VPC with appropriate subnets, security groups, route tables, and network ACLs configured.

## Remediation

### Using AWS Console

To establish connection, the users would need to factor in their virtual private cloud (VPC), create subnet, configure routing, and implement ACLs.

## Default Value

Amazon DocumentDB requires deployment within a VPC. No default network architecture planning is provided.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 12.2 Establish and Maintain a Secure Network Architecture      |      | X    | X    |
| v7               | 11.7 Manage Network Infrastructure Through a Dedicated Network |      | X    | X    |

## Profile

Level 1 | Manual
