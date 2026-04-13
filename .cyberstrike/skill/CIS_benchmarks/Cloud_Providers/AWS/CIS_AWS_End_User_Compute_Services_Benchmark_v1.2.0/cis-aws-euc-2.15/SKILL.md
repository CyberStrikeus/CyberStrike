---
name: cis-aws-euc-2.15
description: "Ensure primary interface ports for Workspaces are not open to all inbound traffic"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, workspaces, network-security, security-groups]
cis_id: "2.15"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure primary interface ports for Workspaces are not open to all inbound traffic (Automated)

## Description

Ensure that the inbound traffic of the primary network interface for all WorkSpaces is not open to all connections 0.0.0.0/0.

## Rationale

Attached security groups to the primary elastic network interface (ENI) to manage ports and network communication should not be open to all communication. They should be restricted to what is required by WorkSpaces, the Organization and other services.

## Impact

None

## Audit Procedure

### Using AWS Console

Perform the steps below to confirm security groups are configured correctly.

1. Login to the VPC console at https://console.aws.amazon.com/vpc/
2. In the left pane, click Your VPCs
3. Note the VPC Id for WorkSpaces
4. In the left pane, click Security Groups
5. In the Filter security groups enter the name of the WorkSpaces VPC
6. Select the WorkSpaces Security Group
7. Click on Inbound rules
8. Confirm that there is no rule for All traffic, All, All, 0.0.0.0/0, -

If there is a rule for Inbound traffic that is open to all traffic and all ip addresses refer to the remediation below.

### Expected Result

No security group rules allow unrestricted inbound access (0.0.0.0/0) to all ports.

## Remediation

### Using AWS Console

Perform the steps below to remove Inbound rule that allows all traffic from all IP addresses.

1. Login to the VPC console at https://console.aws.amazon.com/vpc/
2. In the left pane, click Your VPCs
3. Note the VPC Id for WorkSpaces
4. In the left pane, click Security Groups
5. In the Filter security groups enter the name of the WorkSpaces VPC
6. Select the WorkSpaces Security Group
7. Click on Inbound rules
8. Click on Edit inbound rules
9. Click on Delete for the rule that shows
   - All traffic, All, All, 0.0.0.0/0, -
10. Click on Save rules

**Note:** Make sure you have all the required ports add to Inbound rules as listed in the WorkSpaces documentation outlined in the references so that connectivity to WorkSpaces is not impacted.

## Default Value

By default, the following open inbound ports are open:

- Inbound TCP on port 4172. This is used for establishment of the streaming connection on the PCoIP protocol.
- Inbound UDP on port 4172. This is used for streaming user input on the PCoIP protocol.
- Inbound TCP on port 4489. This is used for access using the web client.
- Inbound TCP on port 8200. This is used for management and configuration of the WorkSpace.
- Inbound TCP on ports 8201-8250. These ports are used for establishment of the streaming connection and for streaming user input on the DCV protocol.

## References

1. https://docs.aws.amazon.com/workspaces/latest/adminguide/workspaces-port-requirements.html#gateway_IP
2. https://aws.amazon.com/workspaces/resources/?workspaces-whats-new.sort-by=item.additionalFields.postDateTime&workspaces-whats-new.sort-order=desc
3. https://d1.awsstatic.com/whitepapers/workspaces/Best_Practices_for_Deploying_Amazon_WorkSpaces.pdf
4. https://docs.aws.amazon.com/workspaces/latest/adminguide/workspaces-port-requirements.html

## CIS Controls

**Controls Version v8:**

- 3.3 Configure Data Access Control Lists

**Controls Version v7:**

- 4.4 Implement and Manage a Firewall on Servers
- 4.5 Implement and Manage a Firewall on End-User Devices
- 12.4 Deny Communication over Unauthorized Ports
- 14.6 Protect Information through Access Control Lists

## Profile

Level 1
