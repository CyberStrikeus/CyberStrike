---
name: cis-aws-database-11.2
description: "Ensure Network Access is Secure"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, qldb, ledger, network-security, vpc, privatelink]
cis_id: "11.2"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-11.1, cis-aws-database-11.3, cis-aws-database-11.4]
prerequisites: []
severity_boost: {}
---

# 11.2 Ensure Network Access is Secure (Manual)

## Description

By applying certain network access such as Virtual Private Cloud (VPC) it protects the private network that has been established from any external networks from interfering. It allows internal networks to communicate with one another with the network that has been established. The Access Control List (ACLs) allows only specific individuals to access the resources. Also, by monitoring and logging the activity within the database it helps the individual know what is being logged within the activity and determine what next step they should take to address it.

## Rationale

Network security controls protect QLDB resources from unauthorized network access and provide defense-in-depth through VPC isolation, security groups, and network ACLs.

## Impact

Setting these certain rules in your network provides a strong security and prevents the organization suffering a ransomware attack.

## Audit Procedure

### Using AWS Console

1. Deploy QLDB in a VPC:
   - Create a Virtual Private Cloud (VPC) to isolate your QLDB resources.
   - Define the network CIDR blocks, subnets, and routing configurations for the VPC.
   - Ensure that the VPC is correctly configured with appropriate network access controls.
2. Configure Security Groups:
   - Create security groups within your VPC to control inbound and outbound traffic to QLDB.
   - Determine the necessary protocols and ports for QLDB access.
   - Configure security group rules to allow access from trusted sources, such as specific IP ranges or other security groups within your VPC.
3. Set Up Network ACLs:
   - Configure Network Access Control Lists (ACLs) within your VPC to provide an additional layer of network security.
   - Define inbound and outbound rules in the ACLs to allow or deny specific traffic based on IP addresses, ports, or protocols.
   - Review and adjust the ACL rules to align with your organization's security policies and requirements.
4. Use VPC Endpoints or PrivateLink:
   - Consider using VPC endpoints or AWS PrivateLink to securely access QLDB without traversing the public internet.
   - Set up a VPC endpoint for QLDB to allow private connectivity within your VPC.
   - Configure the routing and security group rules to enable traffic flow through the VPC endpoint or PrivateLink.
5. Secure External Connections:
   - If external connections to QLDB are required, implement secure access methods such as Virtual Private Network (VPN) or AWS Direct Connect.
   - Configure VPN connections or Direct Connect links to establish encrypted and private connectivity between your on-premises network and the VPC hosting QLDB.
   - Apply appropriate security measures, such as strong authentication and encryption, to protect data transmitted over external connections.
6. Enable Logging and Monitoring:
   - Enable logging for QLDB to capture important system events and database activity.
   - Utilize services like Amazon CloudWatch Logs to centralize and analyze QLDB logs.
   - Set up appropriate alarms and notifications to alert you of any suspicious network activity or potential security incidents.
7. Regularly Review and Update Network Security:
   - Regularly review your VPC configurations, security groups, and network ACLs.
   - Stay informed about AWS security best practices and recommendations.
   - Update your network security measures as needed to address emerging threats or changes in your security requirements.

## Expected Result

QLDB should be accessed through VPC endpoints or PrivateLink, with properly configured security groups and network ACLs restricting access to authorized sources only.

## Remediation

### Using AWS Console

Follow the audit steps above to configure network security for your Amazon QLDB environment.

## Default Value

QLDB is accessed via HTTPS API calls. VPC endpoints and PrivateLink must be manually configured for private network access.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 12.2 Establish and Maintain a Secure Network Architecture      |      | x    | x    |
| v7               | 11.7 Manage Network Infrastructure Through a Dedicated Network |      | x    | x    |

## Profile

Level 1 | Manual
