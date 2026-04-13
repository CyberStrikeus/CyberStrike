---
name: cis-aws-foundations-6.3
description: "Ensure no security groups allow ingress from 0.0.0.0/0 to remote server administration ports"
category: cis-networking
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, networking, security-groups, vpc, ssh, rdp]
cis_id: "6.3"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-6.2, cis-aws-foundations-6.4, cis-aws-foundations-6.5]
prerequisites: []
severity_boost: {}
---

# Ensure no security groups allow ingress from 0.0.0.0/0 to remote server administration ports

## Description

Security groups provide stateful filtering of ingress and egress network traffic to AWS resources. It is recommended that no security group allows unrestricted ingress access to remote server administration ports, such as SSH on port 22 and RDP on port 3389, using either the TCP (6), UDP (17), or ALL (-1) protocols.

## Rationale

Public access to remote server administration ports, such as 22 (when used for SSH, not SFTP) and 3389, increases the attack surface of resources and unnecessarily raises the risk of resource compromise.

## Impact

When updating an existing environment, ensure that administrators have access to remote server administration ports through another mechanism before removing access by deleting the 0.0.0.0/0 inbound rule.

## Audit Procedure

### Using AWS Console

1. Login to the AWS VPC Console at https://console.aws.amazon.com/vpc/home.
2. In the left pane, click `Security Groups`.
3. For each security group, perform the following:
   - Select the security group.
   - Click the `Inbound Rules` tab.
   - Ensure that no rule exists which has a port range including port 22 or 3389, uses the protocols TCP (6), UDP (17), or ALL (-1), or other remote server administration ports for your environment, and has a `Source` of `0.0.0.0/0`.

**Note:**

- A port value of ALL or a port range such as 0-3389 includes port 22, 3389, and potentially other remote server administration ports.
- Security groups are stateful and do not support explicit DENY rules. Therefore, an "effective ruleset" approach (e.g., allowing ANY/ANY but denying specific ports) is not applicable. Any rule that allows 0.0.0.0/0 access to administrative ports is considered non-compliant and must be removed or restricted.

### Using AWS CLI

1. Check all security groups for insecure inbound rules allowing traffic from 0.0.0.0/0:

```bash
aws ec2 describe-security-group-rules --query 'SecurityGroupRules[?CidrIpv4 == "0.0.0.0/0" && IsEgress == `false`]' --output json
```

## Expected Result

No security group should have inbound rules allowing traffic from 0.0.0.0/0 to port 22 or 3389.

## Remediation

### Using AWS Console

1. Login to the AWS VPC Console at https://console.aws.amazon.com/vpc/home.
2. In the left pane, click `Security Groups`.
3. For each security group, perform the following:
   - Select the security group.
   - Click the `Inbound Rules` tab.
   - Click the `Edit inbound rules` button.
4. Identify the rules to be edited or removed.
5. Either:
   A) update the Source field to a range other than 0.0.0.0/0, or B) click `Delete` to remove the offending inbound rule.
   - Click `Save rules`.

### Using AWS CLI

1. Check all security groups for insecure inbound rules allowing traffic from 0.0.0.0/0:

```bash
aws ec2 describe-security-group-rules --query 'SecurityGroupRules[?CidrIpv4 == "0.0.0.0/0" && IsEgress == `false`]' --output json
```

2. Delete the insecure rule(s) based on their rule ID:

```bash
aws ec2 delete-security-group-rules --group-id <security_group_id> --security-group-rule-ids <rule_id_to_delete>
```

3. Recreate necessary security group rules:

```bash
aws ec2 authorize-security-group-ingress --group-id <security_group_id> --protocol <tcp, udp, icmp or all> --port <port> --cidr <souce_cidr>
```

## Default Value

By default, security groups may be configured to allow unrestricted ingress (0.0.0.0/0) on ports like SSH (22) or RDP (3389). AWS does not block this automatically; restrictions must be applied manually.

## References

1. https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-security-groups.html#deleting-security-group-rule

## Additional Information

Use the following command to list all potentially non-compliant security groups in a table format:

```
aws ec2 describe-security-groups --query "SecurityGroups[?IpPermissions[?IpRanges[?CidrIp=='0.0.0.0/0']]].{GroupId:GroupId,GroupName:GroupName,Description:Description,VpcId:VpcId,InboundRules:IpPermissions[].{Protocol:IpProtocol,FromPort:FromPort,ToPort:ToPort,CidrIpv4:IpRanges[].CidrIp,CidrIpv6:Ipv6Ranges[*].CidrIpv6}}" --output table
```

## CIS Controls

| Controls Version | Control                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.5 Implement and Manage a Firewall on End-User Devices | x    | x    | x    |
| v7               | 9.4 Apply Host-based Firewalls or Port Filtering        | x    | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1070                       | TA0011  | M1037       |

## Profile

Level 1 | Automated
