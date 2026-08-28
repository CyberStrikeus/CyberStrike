---
name: cis-aws-euc-5.1
description: "Ensure AppStream is utilizing its own virtual private cloud (VPC)"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, appstream, vpc, network-isolation]
cis_id: "5.1"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: [CWE-668]
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure AppStream is utilizing its own virtual private cloud (VPC) (Manual)

## Profile Applicability

- Level 1

## Description

AppStream 2.0 should be configured using a VPC with Private subnets and a NAT Gateway.

## Rationale

For AppStream 2.0 the public subnet will have direct access to the internet through the NAT gateway. This setup allows the streaming instances in your private subnets to connect to the internet or other AWS services.

## Impact

None - this is a security best practice.

## Audit Procedure

Perform the following to determine if a VPC is setup for AppStream 2.0 correctly.

### Using AWS Console

1. Login to the VPC console at `https://console.aws.amazon.com/vpc/`
2. In the left pane, click **Your VPCs**
3. Select the VPC for AppStream 2.0 and take note of the name and the VPC ID
4. In the left pane, click **Subnets**
5. Confirm you have 3 subnets labeled and associated with the VPC:
   - 1 AppStream Public Subnet and 2 AppStream Private Subnets
6. Confirm the **AppStream Public Subnet** is configured correctly:
   - Select AppStream Public subnet
   - Description tab - VPC matches `AppStream ID and name`
   - Route Table tab - verify contains rules:
     - `Example` - Destination - 10.0.0.0/20, Target - local
     - `Example` - Destination - 0.0.0.0/0, Target - internet_gateway_ID

7. Confirm the **2 AppStream Private Subnets** are configured correctly:
   - Select AppStream Private subnet 1
   - Description Tab - VPC matches `AppStream ID and name` and note Availability zone
   - Route Table tab - verify contains routes:
     - `Example` - Destination - 10.0.0.0/20, Target - local
     - `Example` - Destination - 0.0.0.0/0, Target - nat_gateway_ID
     - `Example- optional` - Destination - S3bucket_enpoint_ID, Target - storage_vpce_ID
   - Select AppStream Private subnet 2
   - Description Tab - VPC matches `AppStream ID and name` and Availability zone is set to something different than Private subnet 1
   - Route Table tab - verify contains routes:
     - `Example` - Destination - 10.0.0.0/20, Target - local
     - `Example` - Destination - 0.0.0.0/0, Target - nat_gateway_ID
     - `Example- optional` - Destination - S3bucket_enpoint_ID, Target - storage_vpce_ID

If The AppStream VPC, subnets and route tables are not configured correctly refer to the remediation procedure below.

### Using AWS CLI

Not applicable - must be audited via Console.

## Expected Result

AppStream has a dedicated VPC with 1 public subnet and 2 private subnets with proper route tables configured.

## Remediation

### Using AWS Console

Perform the steps below to create a VPC, subnets and routing table for AppStream 2.0.

**Allocate an Elastic IP address:**

1. Login in to the Amazon VPC console at `https://console.aws.amazon.com/vpc/`
2. In the left pane, click **Elastic IPs**
3. Click **Allocate new address**
4. Then click on **Allocate**
5. Make a note of the Elastic IP address
6. Click **Close**

**Create a New VPC with one public subnet and two private subnets:**

1. Login to the VPC console at `https://console.aws.amazon.com/vpc/`
2. Click **Launch VPC Wizard**
3. Choose VPC with Public and Private Subnet's **and then click Select**
4. Configure the VPC as follows:
   - `IPv4 CIDR block` - enter a CIDR block from the private (non-publicly routable) IP address range i.e. 10.0.0.0/16
   - `IPv6 CIDR block` - Accept the default value - No IPv6 CIDR Block
   - `VPC name` enter a name for the VPC (example, AppStream VPC)
   - `Public subnet's IPv4 CIDR` - enter a CIDR block from the private (non-publicly routable) IP address range i.e. 10.0.0.0/24
   - `Availability Zone` - Accept the default value - No Preference
   - `Public subnet name` - enter a name for the subnet (example, AppStream Public Subnet)
   - `Private subnet's IPv4 CIDR` - enter the CIDR block for the subnet
   - `Availability Zone` - Accept the default value - No Preference
   - `Private subnet name` - enter a name for the subnet (example, AppStream Private Subnet 1)
   - `Elastic IP Allocation ID` - enter the Elastic IP address that you created
   - `Service Endpoints` - Accept the default value - Blank
   - `Enable DNS hostnames` - Accept the default value - Yes
   - `Hardware tenancy` - Accept the default value - Default

5. Click on **Create VPC**

**Note:** It takes several minutes to set up your VPC. After the VPC is created, choose OK.

**Create the Second Private subnet to the VPC:**

1. In the left pane, choose **Subnets**
2. Click Create subnet

   **Name tag** - enter a name for the private subnet (example, AppStream Private subnet 2)
   - `VPC` - select the VPC that you created for AppStream 2.0
   - `Availability Zone` - select a different one than you are using for AppStream2 Private subnet 1
   - `IPv4 CIDR block` - enter the CIDR block for the subnet

3. Click Create

**Verify and Name the Route Tables:**

1. In the left pane, choose **Subnets**
2. Select the public subnet that you created (example, AppStream Public subnet)
3. On the Route Table tab, click the ID of the route table (example, rtb-12345678)
4. Select the route table. Under Name, choose the edit icon (the pencil), enter a name (for example, appstream-public-routetable), then click the check mark to save
5. On the Routes tab, confirm one destination and target for local traffic and another destination and target that sends all other traffic to the internet gateway (example, igw-0518a307898725db2)
6. In the left pane, choose **Subnets**
7. Select the first private subnet that you created (example, AppStream Private subnet 1)
8. On the Route Table tab, click the ID of the route table (example, rtb-12345678)
9. Select the route table. Under Name, choose the edit icon (the pencil), enter a name (for example, appstream-private-routetable1), then click the check mark to save
10. On the Routes tab, confirm one destination and target for local traffic and another destination and target that sends all other traffic to the NAT gateway (example, nat-06ea352539b2fddfc)
11. In the left pane, choose **Subnets**
12. Select the second private subnet that you created (example, AppStream Private subnet 2)
13. On the Route Table tab, click the ID of the route table (example, rtb-12345678)
14. Select the route table. Under Name, choose the edit icon (the pencil), enter a name (for example, appstream-private-routetable2), then click the check mark to save
15. On the Routes tab, confirm one destination and target for local traffic and another destination and target that sends all other traffic to the NAT gateway (example, nat-06ea352539b2fddfc)

### Using AWS CLI

Not applicable - must be configured via Console.

## Default Value

By default, there is no VPC tied to the Appstream 2.0 service.

## References

1. https://docs.aws.amazon.com/appstream2/latest/developerguide/vpc-setup-recommendations.html
2. https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Subnets.html#vpc-sizing-ipv4

## CIS Controls

**v8:**

- 3.12 Segment Data Processing and Storage Based on Sensitivity
  - Segment data processing and storage based on the sensitivity of the data. Do not process sensitive data on enterprise assets intended for lower sensitivity data.

**v7:**

- 14.1 Segment the Network Based on Sensitivity
  - Segment the network based on the label or classification level of the information stored on the servers, locate all sensitive information on separated Virtual Local Area Networks (VLANs).

## Profile

Level 1
