---
name: cis-aws-foundations-6.5
description: "Ensure the default security group of every VPC restricts all traffic"
category: cis-networking
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, networking, security-groups, vpc, default-security-group]
cis_id: "6.5"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-6.3, cis-aws-foundations-6.4, cis-aws-foundations-6.6]
prerequisites: []
severity_boost: {}
---

# Ensure the default security group of every VPC restricts all traffic

## Description
A VPC comes with a default security group whose initial settings deny all inbound traffic, allow all outbound traffic, and allow all traffic between instances assigned to the security group. If a security group is not specified when an instance is launched, it is automatically assigned to this default security group. Security groups provide stateful filtering of ingress/egress network traffic to AWS resources. It is recommended that the default security group restrict all traffic, both inbound and outbound.

The default VPC in every region should have its default security group updated to comply with the following:
- No inbound rules.
- No outbound rules.

Any newly created VPCs will automatically contain a default security group that will need remediation to comply with this recommendation.

**Note:** When implementing this recommendation, VPC flow logging is invaluable in determining the least privilege port access required by systems to work properly, as it can log all packet acceptances and rejections occurring under the current security groups. This dramatically reduces the primary barrier to least privilege engineering by discovering the minimum ports required by systems in the environment. Even if the VPC flow logging recommendation in this benchmark is not adopted as a permanent security measure, it should be used during any period of discovery and engineering for least privileged security groups.

## Rationale
Configuring all VPC default security groups to restrict all traffic will encourage the development of least privilege security groups and promote the mindful placement of AWS resources into security groups, which will, in turn, reduce the exposure of those resources.

## Impact
Implementing this recommendation in an existing VPC that contains operating resources requires extremely careful migration planning, as the default security groups are likely enabling many ports that are unknown. Enabling VPC flow logging (for accepted connections) in an existing environment that is known to be breach-free will reveal the current pattern of ports being used for each instance to communicate successfully. The migration process should include:
- Analyzing VPC flow logs to understand current traffic patterns.
- Creating least privilege security groups based on the analyzed data.
- Testing the new security group rules in a staging environment before applying them to production.

## Audit Procedure

### Using AWS Console

**Security Group State:**
1. Login to the AWS VPC Console at https://console.aws.amazon.com/vpc/home.
2. Repeat the following steps for all VPCs, including the default VPC in each AWS region:
3. In the left pane, click `Security Groups`.
4. For each default security group, perform the following:
   - Select the `default` security group.
   - Click the `Inbound Rules` tab and ensure no rules exist.
   - Click the `Outbound Rules` tab and ensure no rules exist.

**Security Group Members:**
1. Login to the AWS VPC Console at https://console.aws.amazon.com/vpc/home.
2. Repeat the following steps for all default groups in all VPCs, including the default VPC in each AWS region:
3. In the left pane, click `Security Groups`.
4. Copy the ID of the default security group.
5. Change to the EC2 Management Console at https://console.aws.amazon.com/ec2/v2/home.
6. In the filter column type `Security Group ID : <security-group-id-from-step-4>`.

### Using AWS CLI
1. List all default security groups in the specified region:

```bash
aws ec2 describe-security-groups --region <region-name> --query 'SecurityGroups[?GroupName == `default`]'
```

2. Check if the inbound rules (IpPermissions) and outbound rules (IpPermissionsEgress) of the default security group are empty. If the rules are not empty, proceed and note down the Security Group ID (GroupId) of the security group with non-empty rules.

3. List the inbound security group rule IDs (SecurityGroupRuleId):

```bash
aws ec2 describe-security-group-rules --region <region-name> --query 'SecurityGroupRules[?GroupId == `<default-security-group-id>` && IsEgress == `false`]'
```

## Expected Result
The default security group in every VPC should have no inbound rules and no outbound rules.

## Remediation

**Security Group Members:**
1. Identify AWS resources that exist within the default security group.
2. Create a set of least-privilege security groups for those resources.
3. Place the resources in those security groups, removing the resources noted in step 1 from the default security group.

### Using AWS Console
1. Login to the AWS VPC Console at https://console.aws.amazon.com/vpc/home.
2. Repeat the following steps for all VPCs, including the default VPC in each AWS region:
3. In the left pane, click `Security Groups`.
4. For each default security group, perform the following:
   - Select the `default` security group.
   - Click the `Inbound Rules` tab.
   - Remove any inbound rules.
   - Click the `Outbound Rules` tab.
   - Remove any Outbound rules.

### Using AWS CLI
1. List all default security groups in the specified region:

```bash
aws ec2 describe-security-groups --region <region-name> --query 'SecurityGroups[?GroupName == `default`]'
```

2. Check if the inbound rules (IpPermissions) and outbound rules (IpPermissionsEgress) of the default security group are empty. If the rules are not empty, proceed and note down the Security Group ID (GroupId) of the security group with non-empty rules.

3. List the inbound security group rule IDs (SecurityGroupRuleId):

```bash
aws ec2 describe-security-group-rules --region <region-name> --query 'SecurityGroupRules[?GroupId == `<default-security-group-id>` && IsEgress == `false`]'
```

4. Delete the inbound security group rules based on their rule IDs:

```bash
aws ec2 revoke-security-group-ingress --group-id <default-security-group-id> --security-group-rule-ids <inbound-rule-id-1> <inbound-rule-id-2>
```

5. List the outbound security group rule IDs (SecurityGroupRuleId):

```bash
aws ec2 describe-security-group-rules --region <region-name> --query 'SecurityGroupRules[?GroupId == `<default-security-group-id>` && IsEgress == `true`]'
```

6. Delete the outbound security group rules based on their rule IDs:

```bash
aws ec2 revoke-security-group-egress --group-id <default-security-group-id> --security-group-rule-ids <outbound-rule-id-1> <outbound-rule-id-2>
```

**Recommended:** IAM groups allow you to edit the "name" field. After remediating default group rules for all VPCs in all regions, edit this field to add text similar to "DO NOT USE. DO NOT ADD RULES."

## Default Value
By default, each VPC has a "default" security group that allows all outbound traffic and all traffic between resources within the group. No restrictions are enforced unless manually configured.

## References
1. CCE-79201-0
2. https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-network-security.html
3. https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-security-groups.html#default-security-group

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v8 | 4.5 Implement and Manage a Firewall on End-User Devices | x | x | x |
| v7 | 9.4 Apply Host-based Firewalls or Port Filtering | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1071 | TA0011 | M1037 |

## Profile
Level 2 | Automated
