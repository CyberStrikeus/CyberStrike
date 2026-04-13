---
name: cis-aws-euc-2.4
description: "Ensure WorkSpaces are deployed in their own virtual private cloud (VPC)"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, workspaces, vpc, network-segmentation, nat-gateway]
cis_id: "2.4"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-euc-2.5]
prerequisites: []
severity_boost: {}
---

# Ensure WorkSpaces are deployed in their own virtual private cloud (VPC) (Manual)

## Profile Applicability
- Level 1

## Description
Amazon WorkSpaces VPC should be created with two private subnets for your WorkSpaces and a NAT gateway in a public subnet.

## Rationale
The NAT gateway will provide WorkSpaces access to the internet for updates to the operating system and so that applications can be deployed using Amazon WorkSpaces Application Manager if that is applicable for your environment.

## Impact
Your VPC's subnets must be in different Availability Zones in the Region where you're launching WorkSpaces.

## Audit Procedure

### Using AWS Console

Perform the following steps to confirm that a VPC exists for WorkSpaces and is configured correctly:

1. Login to the VPC console at https://console.aws.amazon.com/vpc/
2. In the left pane, click **Your VPC's**
3. Select the VPC for WorkSpaces
4. Confirm the IPv4 settings are using a CIDR block from the private (non-publicly routable) IP address ranges. For example, 10.0.0.0/16. For more information, see the references below
5. Confirm the IPv6 CIDR Block, set to **No**
6. Confirm the IPv4 CIDR block for the public subnet (example - WorkSpaces Public Subnet)
   - Availability Zone, set to **No Preference**
7. Confirm the IPv4 CIDR block for the first private subnet (example - WorkSpaces Private Subnet 1)
   - Availability Zone, set for Amazon WorkSpaces
   - Elastic IP Allocation ID
   - Service endpoints - `Blank`
   - Enable DNS hostnames, set to `Yes`
   - Hardware tenancy, Default
8. Confirm the IPv4 CIDR block for the first private subnet (example - WorkSpaces Private Subnet 2)
   - Availability Zone set for Amazon WorkSpaces
     - NOTE: Make sure you select a different Availability zone from the one you selected for the Workspaces Private Subnet 1
   - Elastic IP Allocation ID
   - Service endpoints - Blank
   - Enable DNS hostnames, set to `Yes`
   - Hardware tenancy, Default

If this is not set as referenced above refer to the remediation procedure below.

## Remediation

### Using AWS Console

**Allocate an Elastic IP Address**

1. Login in to the VPC console at https://console.aws.amazon.com/vpc/
2. In the left pane, click **Elastic IPs**
3. Click **Allocate new address**
4. On the Allocate new address page, for IPv4 address pool, click **Amazon pool or Owned by me**
5. Click **Allocate**
6. Make a note of the Elastic IP address, click **Close**

**Create a VPC with one public subnet and two private subnets as follows:**

1. Login in to the VPC console at https://console.aws.amazon.com/vpc/
2. In the left pane, click **VPC Dashboard** in the upper-left corner
3. Click **Launch VPC Wizard**
4. Click **VPC with Public and Private Subnets**
5. Click **Select**
6. Configure the VPC as follows:
   - For IPv4 CIDR block, enter the CIDR block from the private (non-publicly routable) IP address ranges. For example 10.0.0.0/16
   - For IPv6 CIDR block, keep `No IPv6 CIDR Block`
   - For VPC name, enter a `name for the VPC` (example: WorkspacesVPC)
   - For Public subnet's IPv4 CIDR - enter a CIDR block from the private (non-publicly routable) IP address ranges. For example - 10.0.0.0/24
   - For Availability Zone, keep `No Preference`
   - For Public subnet name, enter a `name for the subnet` (example: WorkSpaces Public Subnet)
   - For Private subnet's IPv4 CIDR, enter the CIDR block for the subnet
   - `Availability Zone` - Accept the default value = `No Preference`
   - For Private subnet name, enter a `name for the subnet` (example: WorkSpaces Private Subnet 1)
   - For Elastic IP Allocation ID, enter the Elastic IP address that you created
   - For Service endpoints, `do nothing`
   - For Enable DNS hostnames, keep `Yes`
   - For Hardware tenancy, keep `Default`

7. Click Create VPC. Note that it takes several minutes to set up your VPC. After the VPC is created
8. Click **OK**

**Create a Second Private Subnet**

1. In the left pane, click **Subnets**
2. Click **Create Subnet**
   - For Name tag, enter a `name for the private subnet` (example: WorkSpaces Private Subnet 2)
   - For VPC, `select the VPC` that you created
   - For Availability Zone. Make sure you select a different Availability Zone from the one you used in WorkSpaces Private Subnet 1
   - For IPv4 CIDR block, enter the CIDR block for the subnet
3. Click **Create**

**Verify and Name the Route Tables for Public**

1. In the left pane, click **Subnets**
2. Click the **public** subnet that you created. (example: WorkSpaces Public Subnet)
3. On the Route Table tab, choose the ID of the route table (example: rtb-12345678)
4. Click the route table
5. Under Name, choose the edit icon, **enter a name** (example: workspaces-public-routetable)
6. Click the check mark to save the name

**Verify and Name the Route Tables for Private**

1. In the left pane, click **Subnets**
2. Click the **private subnet 1** that you created. (example: WorkSpaces Private Subnet 1)
3. On the Route Table tab, choose the ID of the route table (example: rtb-12345678)
4. Click the route table
5. Under Name, choose the edit icon, **enter a name** (example: workspaces-private-routetable)
6. Click the check mark to save the name
7. On the Routes tab, verify that there is one route for local traffic and another route that sends all other traffic to the internet gateway for the VPC
8. Repeat steps 1-7 under **Verify and Name the Route Tables for Private** `for` WorkSpaces Private Subnet 2'

## Default Value
By default, AWS Workspaces does not create its own VPC. A VPC must be created to run an AWS Workspace environment.

## References
1. https://docs.aws.amazon.com/workspaces/latest/adminguide/amazon-workspaces-vpc.html
2. https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Subnets.html#vpc-sizing-ipv4
3. https://docs.aws.amazon.com/workspaces/latest/adminguide/azs-workspaces.html

## CIS Controls
**v8:**
- 3.12 Segment Data Processing and Storage Based on Sensitivity
  - Segment data processing and storage based on the sensitivity of the data. Do not process sensitive data on enterprise assets intended for lower sensitivity data.

**v7:**
- 14.1 Segment the Network Based on Sensitivity
  - Segment the network based on the label or classification level of the information stored on the servers, locate all sensitive information on separated Virtual Local Area Networks (VLANs).
