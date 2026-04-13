---
name: cis-aws-database-8.2
description: "Ensure Network Security is Enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, keyspaces, cassandra, network-security, vpc]
cis_id: "8.2"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-8.1, cis-aws-database-8.3, cis-aws-database-8.4]
prerequisites: []
severity_boost: {}
---

# 8.2 Ensure Network Security is Enabled (Manual)

## Description

In order to access Amazon Keyspaces the user is required to set specific networking parameters and security measurements without these extra steps they will not be able to access it. Users are required to create or select a virtual private cloud (VPC) and define their inbound and outbound rules accordingly.

## Rationale

Proper network security configuration ensures that only authorized users have access to the database, limiting the risk of attacks through network isolation and access controls.

## Impact

Only authorized users have access to the database which limits and controls any risk of an attack. This ensures better performance of the system to a private network and better security.

## Audit Procedure

### Using AWS Console

1. Create or Select a Virtual Private Cloud (VPC):
   - Sign in to the AWS Management Console and open the Amazon VPC console at https://console.aws.amazon.com/vpc/.
   - Create a new VPC or select an existing VPC where you want to deploy your Amazon Keyspaces resources.
2. Configure Subnets:
   - In the VPC console, navigate to `Subnets` in the left-side menu.
   - Create or select the subnets within your VPC where you want to deploy your Amazon Keyspaces resources.
   - Ensure you have private subnets to isolate your Keyspaces resources from the public internet.
3. Define Security Groups:
   - In the VPC console, navigate to `Security Groups` in the left-side menu.
   - Create a new security group or select an existing one for your Amazon Keyspaces resources.
   - Configure inbound and outbound rules in the security group to control traffic access.
     - Allow inbound access only from trusted sources, such as specific IP ranges or security groups, on the necessary ports used by Amazon Keyspaces.
     - Define outbound rules based on your requirements, allowing outbound traffic to necessary destinations or ports.
   - Associate the security group with your Amazon Keyspaces resources.
4. Configure Network Access Control Lists (ACLs):
   - In the VPC console, navigate to `Network ACLs` in the left-side menu.
   - Create or select the network ACLs associated with the subnets used by your Amazon Keyspaces resources.
   - Configure inbound and outbound rules in the network ACLs to control traffic access.
     - Define rules based on your security requirements, allowing only necessary protocols, ports, and IP ranges.
     - Deny unnecessary or unwanted traffic.
   - Associate the network ACLs with the subnets used by your Amazon Keyspaces resources.
5. Configure VPC Endpoints:
   - In the VPC console, navigate to `Endpoints` in the left-side menu.
   - Create or select the VPC endpoints required for Amazon Keyspaces.
   - If you need to access Keyspaces from within your VPC, create a VPC endpoint for Amazon Keyspaces to connect your applications securely.
   - If you need to access Keyspaces from another VPC or on-premises network, set up VPC peering or a transit gateway to establish a secure connection.
6. Verify Connectivity and Test:
   - Launch an Amazon EC2 instance within the same VPC and subnet as your Amazon Keyspaces resources or use an existing one.
   - Connect to the EC2 instance using SSH or other remote access methods.
   - Test the connectivity to your Amazon Keyspaces resources by trying to connect to them using the appropriate client or utility.
   - Verify that the network security settings allow the necessary traffic and deny unauthorized access.

## Expected Result

VPC, subnets, security groups, network ACLs, and VPC endpoints should be properly configured to isolate and protect Amazon Keyspaces resources.

## Remediation

### Using AWS Console

Follow the audit steps above to configure VPC, subnets, security groups, network ACLs, and VPC endpoints for your Amazon Keyspaces resources.

## Default Value

No default network security configuration is applied. Users must manually configure VPC and related network security settings.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 12.2 Establish and Maintain a Secure Network Architecture      |      | x    | x    |
| v7               | 11.7 Manage Network Infrastructure Through a Dedicated Network |      | x    | x    |

## Profile

Level 1 | Manual
