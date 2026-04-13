---
name: cis-aws-foundations-6.1.2
description: "Ensure CIFS access is restricted to trusted networks to prevent unauthorized access"
category: cis-networking
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, networking, ec2, security-groups, cifs]
cis_id: "6.1.2"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-6.1.1, cis-aws-foundations-6.3, cis-aws-foundations-6.4]
prerequisites: []
severity_boost: {}
---

# Ensure CIFS access is restricted to trusted networks to prevent unauthorized access

## Description

Common Internet File System (CIFS) is a network file-sharing protocol that allows systems to share files over a network. However, unrestricted CIFS access can expose your data to unauthorized users, leading to potential security risks. It is important to restrict CIFS access to only trusted networks and users to prevent unauthorized access and data breaches.

## Rationale

Allowing unrestricted CIFS access can lead to significant security vulnerabilities, as it may allow unauthorized users to access sensitive files and data. By restricting CIFS access to known and trusted networks, you can minimize the risk of unauthorized access and protect sensitive data from exposure to potential attackers. Implementing proper network access controls and permissions is essential for maintaining the security and integrity of your file-sharing systems.

## Impact

Restricting CIFS access may require additional configuration and management effort. However, the benefits of enhanced security and reduced risk of unauthorized access to sensitive data far outweigh the potential challenges.

## Audit Procedure

### Using AWS Console

1. Login to the AWS Management Console.
2. Navigate to the EC2 Dashboard and select the Security Groups section under `Network & Security`.
3. Identify the security groups associated with instances or resources that may be using CIFS.
4. Review the inbound rules of each security group to check for rules that allow unrestricted access on port 445 (the port used by CIFS).
   - Specifically, look for inbound rules that allow access from `0.0.0.0/0` or `::/0` on port 445.
5. Document any instances where unrestricted access is allowed and verify whether it is necessary for the specific use case.

### Using AWS CLI

1. Run the following command to list all security groups and identify those associated with CIFS:

```bash
aws ec2 describe-security-groups --region <region-name> --query 'SecurityGroups[*].GroupId'
```

2. Check for any inbound rules that allow unrestricted access on port 445 using the following command:

```bash
aws ec2 describe-security-groups --region < region-name > --group-ids <security-group-id > --query "SecurityGroups[*].IpPermissions[?((IpProtocol=='-1') || (FromPort<=\`445\` && ToPort>=\`445\`))].{IpProtocol:IpProtocol,FromPort:FromPort,ToPort:ToPort,CIDRv4:IpRanges[*].CidrIp,CIDRv6:Ipv6Ranges[*].CidrIpv6}"
```

- Look for `0.0.0.0/0` or `::/0` in the output, which indicates unrestricted access.

3. Repeat the audit for other regions and security groups as necessary.

## Expected Result

No security group should have inbound rules allowing unrestricted access (from `0.0.0.0/0` or `::/0`) on port 445 (CIFS).

## Remediation

### Using AWS Console

1. Login to the AWS Management Console.
2. Navigate to the EC2 Dashboard and select the Security Groups section under `Network & Security`.
3. Identify the security group that allows unrestricted ingress on port 445.
4. Select the security group and click the `Edit Inbound Rules` button.
5. Locate the rule allowing unrestricted access on port 445 (typically listed as `0.0.0.0/0` or `::/0`).
6. Modify the rule to restrict access to specific IP ranges or trusted networks only.
7. Save the changes to the security group.

### Using AWS CLI

1. Run the following command to remove or modify the unrestricted rule for CIFS access:

```bash
aws ec2 revoke-security-group-ingress --region <region-name> --group-id <security-group-id> --protocol tcp --port 445 --cidr 0.0.0.0/0
```

- Optionally, run the `authorise-security-group-ingress` command to create a new rule, specifying a trusted CIDR range instead of `0.0.0.0/0`.

2. Confirm the changes by describing the security group again and ensuring the unrestricted access rule has been removed or appropriately restricted:

```bash
aws ec2 describe-security-groups --region <region-name> --group-ids <security-group-id> --query "SecurityGroups[*].IpPermissions[?((IpProtocol=='-1') || (FromPort<=\`445\` && ToPort>=\`445\`))].{IpProtocol:IpProtocol,FromPort:FromPort,ToPort:ToPort,CIDRv4:IpRanges[*].CidrIp,CIDRv6:Ipv6Ranges[*].CidrIpv6}"
```

3. Repeat the remediation for other security groups and regions as necessary.

## Default Value

By default, security groups can allow unrestricted CIFS access (port 445) if configured, including 0.0.0.0/0 or ::/0. AWS does not automatically restrict this; controls must be set manually to limit access to trusted networks.

## References

None specified in the benchmark.

## CIS Controls

| Controls Version | Control                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.5 Implement and Manage a Firewall on End-User Devices | x    | x    | x    |
| v7               | 9.4 Apply Host-based Firewalls or Port Filtering        | x    | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1530                       | TA0009, TA0010 | M1037       |

## Profile

Level 1 | Automated
