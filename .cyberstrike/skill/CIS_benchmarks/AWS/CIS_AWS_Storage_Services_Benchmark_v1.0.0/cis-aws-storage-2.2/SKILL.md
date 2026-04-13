---
name: cis-aws-storage-2.2
description: "Ensure configuring Security Groups"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, ebs, ec2, security-group, firewall, network-security]
cis_id: "2.2"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: [CWE-284, CWE-923]
chains_with: [cis-aws-storage-2.1, cis-aws-storage-2.3]
prerequisites: [cis-aws-storage-2.1]
severity_boost: {}
---

# CIS Control 2.2: Ensure configuring Security Groups (Manual)

## Profile Applicability

- **Level 2**

## Description

Security groups are your first line of defense for the EC2 instance. A security group is a firewall that controls inbound and outbound traffic.

## Rationale

Security groups play a critical role in maintaining the security of your AWS resources. It is advisable to restrict traffic to only what is necessary for accessing your instance, thereby minimizing potential security risks.

Properly configured security groups:
- Implement network-level access control
- Reduce attack surface by limiting exposed ports
- Enforce principle of least privilege for network access
- Provide stateful firewall protection

## Impact

Improperly configured security groups can lead to:
- Unauthorized network access to EC2 instances
- Exposure of management ports (SSH, RDP) to the internet
- Data exfiltration through unrestricted outbound rules
- Lateral movement within VPC if rules are too permissive
- Compliance violations

## Audit Procedure

### Via AWS Management Console

Open traffic for SSH, HTTP, and HTTPS. Make sure to allow traffic from anywhere, unless you will be accessing the instance from a secure workstation or server with a static IP address.

1. Navigate to EC2 Dashboard → Security Groups
2. Review inbound rules for each security group
3. Check for overly permissive rules (0.0.0.0/0 on sensitive ports)
4. Verify outbound rules follow least privilege

### Via AWS CLI

```bash
# List all security groups
aws ec2 describe-security-groups \
  --query 'SecurityGroups[].[GroupId,GroupName,VpcId]' \
  --output table

# Find security groups with SSH (22) open to the world
aws ec2 describe-security-groups \
  --filters Name=ip-permission.from-port,Values=22 \
  --query 'SecurityGroups[?IpPermissions[?IpRanges[?CidrIp==`0.0.0.0/0`]]].[GroupId,GroupName]' \
  --output table

# Find security groups with RDP (3389) open to the world
aws ec2 describe-security-groups \
  --filters Name=ip-permission.from-port,Values=3389 \
  --query 'SecurityGroups[?IpPermissions[?IpRanges[?CidrIp==`0.0.0.0/0`]]].[GroupId,GroupName]' \
  --output table

# Get detailed security group rules
aws ec2 describe-security-groups \
  --group-ids sg-xxxxxxxxx
```

## Expected Result

- SSH (port 22) and RDP (port 3389) are not open to 0.0.0.0/0
- Only necessary ports are open
- Source IPs are restricted to known, trusted ranges
- Outbound rules follow least privilege where possible
- Security group descriptions clearly indicate purpose

## Remediation

### Via AWS Management Console

1. **Navigate to Security Groups**
   - EC2 Dashboard → Security Groups

2. **Review and Modify Inbound Rules**
   - Select security group
   - Click "Edit inbound rules"
   - Remove or restrict overly permissive rules
   - For SSH/RDP, limit source to specific IP ranges (e.g., corporate VPN)

3. **Configure Appropriate Rules**
   - Allow only necessary traffic
   - Use specific CIDR blocks instead of 0.0.0.0/0
   - Consider using security group references for internal traffic

### Via AWS CLI

```bash
# Revoke overly permissive SSH rule
aws ec2 revoke-security-group-ingress \
  --group-id sg-xxxxxxxxx \
  --protocol tcp \
  --port 22 \
  --cidr 0.0.0.0/0

# Add restricted SSH rule (example: allow from corporate IP)
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxxxxxxxx \
  --protocol tcp \
  --port 22 \
  --cidr 203.0.113.0/24
```

## Default Value

Default security groups deny all inbound traffic and allow all outbound traffic. Custom security groups created by users may have different configurations.

## References

1. [Amazon EC2 Security Groups](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-security-groups.html)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 12.3 Securely Manage Network Infrastructure | ● | ● | ● |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | ● | ● | |

**CIS Control v8 - 12.3 Securely Manage Network Infrastructure:**
Securely manage network infrastructure. Implementations include version-controlled-infrastructure-as-code, and the use of secure network protocols, such as SSH and HTTPS.

**CIS Control v7 - 9.2 Ensure Only Approved Ports, Protocols and Services Are Running:**
Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.

## Notes

- This is a **manual** control requiring review of security group configurations
- Avoid opening ports to 0.0.0.0/0 unless absolutely necessary (e.g., public web servers)
- Use AWS Systems Manager Session Manager as an alternative to direct SSH access
- Regularly audit security groups using AWS Config or third-party tools
- Consider using VPC endpoints for AWS service access instead of internet routing
