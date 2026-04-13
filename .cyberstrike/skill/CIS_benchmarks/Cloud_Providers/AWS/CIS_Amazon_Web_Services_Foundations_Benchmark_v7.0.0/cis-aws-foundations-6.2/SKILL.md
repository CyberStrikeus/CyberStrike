---
name: cis-aws-foundations-6.2
description: "Ensure no Network ACLs allow ingress from 0.0.0.0/0 to remote server administration ports"
category: cis-networking
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, networking, nacl, vpc, ssh, rdp]
cis_id: "6.2"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-6.3, cis-aws-foundations-6.4, cis-aws-foundations-6.5]
prerequisites: []
severity_boost: {}
---

# Ensure no Network ACLs allow ingress from 0.0.0.0/0 to remote server administration ports

## Description

The Network Access Control List (NACL) function provides stateless filtering of ingress and egress network traffic to AWS resources. It is recommended that no NACL allows unrestricted ingress access to remote server administration ports, such as SSH on port 22 and RDP on port 3389, using either the TCP (6), UDP (17), or ALL (-1) protocols.

## Rationale

Public access to remote server administration ports, such as 22 (when used for SSH, not SFTP) and 3389, increases the attack surface of resources and unnecessarily raises the risk of resource compromise.

## Impact

None specified.

## Audit Procedure

### Using AWS Console

1. Login to the AWS VPC Console at https://console.aws.amazon.com/vpc/home.
2. In the left pane, click `Network ACLs`.
3. For each network ACL, check whether it is associated with one or more subnets.
4. If it is associated, proceed to Step 5.
5. If it is not associated, you may still review the rules, but note it has no effect until attached.
6. Select the network ACL.
7. Click the Inbound Rules tab.
8. Ensure that no rule exists which has a port range that includes port 22 or 3389, uses the protocols TCP (6), UDP (17), or ALL (-1), or other remote server administration ports for your environment, has a Source of 0.0.0.0/0, and shows ALLOW.

**Note:**

- A port value of ALL or a port range such as 0-3389 includes port 22, 3389, and potentially other remote server administration ports.
- An effective ruleset that explicitly DENIES access to these ports (e.g., a DENY rule for ports 22 and 3389 from 0.0.0.0/0 placed before a broader ALLOW rule such as ANY/ANY) is considered acceptable, as NACLs are evaluated in order and the DENY rule will take precedence.

### Using AWS CLI

The CLI command to see all the matching ACLs bound to a subnet is:

```bash
aws ec2 describe-network-acls --filters "Name=association.subnet-id,Values=*" --query 'NetworkAcls[].{ACL_ID:NetworkAclId, Subnet_ID:Associations[].SubnetId, Rules:Entries[?Egress==true && RuleAction==allow && (CidrBlock==0.0.0.0/0 || Ipv6CidrBlock==::/0)].{RuleNumber:RuleNumber, Action:RuleAction, Protocol:Protocol, CidrBlock:CidrBlock, Ipv6CidrBlock:Ipv6CidrBlock, PortRange:PortRange}}' --output table
```

For unattached ACLs:

```bash
aws ec2 describe-network-acls --query 'NetworkAcls[].{ACL_ID:NetworkAclId, Subnet_ID:Associations[].SubnetId, Rules:Entries[?Egress==true && RuleAction==allow && (CidrBlock==0.0.0.0/0 || Ipv6CidrBlock==::/0)].{RuleNumber:RuleNumber, Action:RuleAction, Protocol:Protocol, CidrBlock:CidrBlock, Ipv6CidrBlock:Ipv6CidrBlock, PortRange:PortRange}}' --output table
```

## Expected Result

No Network ACL should have inbound rules allowing traffic from 0.0.0.0/0 to port 22 or 3389.

## Remediation

### Using AWS Console

1. Login to the AWS VPC Console at https://console.aws.amazon.com/vpc/home.
2. In the left pane, click `Network ACLs`.
3. For each network ACL that needs remediation, perform the following:
4. Select the network ACL.
5. Click the `Inbound Rules` tab.
6. Click `Edit inbound rules`.
7. Either:
   A) update the Source field to a range other than 0.0.0.0/0
   B) click `Delete` to remove the offending inbound rule
   C) Add an explicit DENY rule for the affected ports (e.g., 22, 3389) from 0.0.0.0/0 with a lower rule number than any broader ALLOW rule
8. Click `Save`.

### Using AWS CLI

No specific CLI remediation commands were provided in the benchmark.

## Default Value

By default, NACLs start with rules that allow all inbound/outbound traffic (or deny all if custom), and administrators may configure them to allow 0.0.0.0/0. AWS does not automatically restrict ports like SSH (22) or RDP (3389); controls must be set manually.

## References

1. https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html
2. https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Security.html#VPC_Security_Comparison

## CIS Controls

| Controls Version | Control                                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------ | ---- | ---- | ---- |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running |      | x    | x    |
| v7               | 12.4 Deny Communication over Unauthorized Ports                    | x    | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1070                       | TA0011  | M1037       |

## Profile

Level 1 | Automated
