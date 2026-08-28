---
name: cis-aws-compute-5.4
description: "Ensure SSH is restricted to only IP address that should have this access"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, lightsail, ssh, ip-restriction, access-control, firewall]
cis_id: "5.4"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-5.3, cis-aws-compute-5.5, cis-aws-compute-5.6]
prerequisites: []
severity_boost: {}
---

# 5.4 Ensure SSH is restricted to only IP address that should have this access (Manual)

## Description

Any ports enable within Lightsail by default are open and exposed to the world. For SSH and RDP access you should identify which IP address need access.

## Rationale

Any ports enable within Lightsail by default are open and exposed to the world. This can result in outside traffic trying to access or even deny access to the Lightsail instances. Removing and adding approved IP address required for access.

## Impact

N/A

## Audit Procedure

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services`, click `Lightsail` under Compute.
3. This will open up the Lightsail console.
4. Select the `Linux Instance` you want to review.
5. Go to the Networking section.
6. Confirm that the SSH Port is restricted to an IP address

| Application | Protocol | Port or range / Code | Restricted to |
| ----------- | -------- | -------------------- | ------------- |
| SSH         | TCP      | 22                   | 101.221.11.11 |

7. If SSH is needed and it is open to `Any IPv4 address` refer to the remediation below.

### Using AWS CLI

1. Run `aws lightsail get-instances`

```bash
aws lightsail get-instances --query "instances[*].name"
```

This command will provide a list of Instance names.

2. Run `aws lightsail get-instance-port-states` for any Linux instances listed

```bash
aws lightsail get-instance-port-states --instance-name <instance_name>
```

This command will provide a list of available Ports for the Instance name.

```json
{
    "fromPort": 22,
    "toPort": 22,
    "protocol": "tcp",
    "state": "open",
    "cidrs": [
        "0.0.0.0/0"
        "101.221.11.11/32"
    ],
    "cidrListAliases": []
},
```

3. Review the Port 22 settings and confirm that the only IP Addresses that should have access to the instance are listed in the cidrs as shown above.
4. If it is open to all ports (0.0.0.0/0) of there is an IP address listed that shouldn't have access refer to the remediation below.

## Expected Result

SSH (Port 22) should be restricted to specific IP addresses that require access. The CIDR should not contain `0.0.0.0/0` (open to all).

## Remediation

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services`, click `Lightsail` under Compute.
3. This will open up the Lightsail console.
4. Select the `Linux Instance` you want to review.
5. Go to the Networking section.
6. Under IPv4 networking find the SSH rule as shown below.

| Application | Protocol | Port or range / Code | Restricted to    |
| ----------- | -------- | -------------------- | ---------------- |
| SSH         | TCP      | 22                   | Any IPv4 address |

7. Click on the edit icon
8. Click on the check box next to Restrict to IP address
9. Under `Source IP address (192.0.2.0) or range (192.0.2.0-192.0.2.255 or 192.0.2.0/24)` type the IP address' you want.

### Using AWS CLI

1. Run `aws lightsail put-instance-public-ports`

```bash
aws lightsail put-instance-public-ports --instance-name <instance_name> --port-info fromPort=22,protocol=TCP,toPort=22,cidrs=110.111.221.100/32,110.111.221.202/32
```

This command will enter the IP addresses that should have access to the instances identified above in the Audit.

2. Run `aws lightsail get-instance-port-states` for the Linux instance to confirm the new setting.

```bash
aws lightsail get-instance-port-states --instance-name <instance_name>
```

This command will provide a list of available Ports and show how the cidr value for Port 22 is now set.

```json
{
    "fromPort": 22,
    "toPort": 22,
    "protocol": "tcp",
    "state": "open",
    "cidrs": [
        "110.111.221.100/32",
        "110.111.221.202/32"
    ],
    "cidrListAliases": []
},
```

3. Repeat the remediation below for all other instances identified in the Audit.

## Default Value

SSH (Port 22) is open to all IPv4 addresses (0.0.0.0/0) by default on Linux Lightsail instances.

## References

1. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/lightsail/index.html#cli-aws-lightsail

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                        | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | x    | x    | x    |

## Profile

Level 1 | Manual
