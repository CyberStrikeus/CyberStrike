---
name: cis-aws-compute-5.3
description: "Disable SSH and RDP ports for Lightsail instances when not needed"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, lightsail, ssh, rdp, ports, firewall, networking]
cis_id: "5.3"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-5.4, cis-aws-compute-5.5, cis-aws-compute-5.6]
prerequisites: []
severity_boost: {}
---

# 5.3 Disable SSH and RDP ports for Lightsail instances when not needed (Manual)

## Description

Any ports enable within Lightsail by default are open and exposed to the world. For SSH and RDP access you should remove and disable these ports when not is use.

## Rationale

Any ports enable within Lightsail by default are open and exposed to the world. This can result in outside traffic trying to access or even deny access to the Lightsail instances. Removing and disabling a protocol when not in use even if restricted by IP address is the safest solution especially when it is not required for access.

## Impact

N/A

## Audit Procedure

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services`, click `Lightsail` under Compute.
3. This will open up the Lightsail console.
4. Select the `Windows or Linux Instance` you want to review.
5. Go to the Networking section.
6. If it is a Windows instance confirm that SSH has been removed. If it is a Linux instance confirm RDP has been removed.
7. If either still exists in the IPV4 Firewall list refer to the remediation below.
8. If the server needs HTTP, TCP Port 80 confirm that the application forwards Port 80 to HTTPS, TCP Port 443.
9. If the server does not need HTTP refer to the remediation below.
10. Confirm that there are no other unused or unneeded ports.
11. If the system has other ports that are not required or in use refer to the remediation below.

### Using AWS CLI

1. Run `aws lightsail get-instances`

```bash
aws lightsail get-instances --query "instances[*].name"
```

This command will provide a list of Instance names.

2. Run `aws lightsail get-instance-port-states` for each instance listed above

```bash
aws lightsail get-instance-port-states --instance-name <instance_name>
```

This command will provide a list of available Ports for the Instance name.

Example output:

```json
"portStates": [
    {
        "fromPort": 80,
        "toPort": 80,
        "protocol": "tcp",
        "state": "open",
        "cidrs": [
            "0.0.0.0/0"
        ],
        "cidrListAliases": []
    },
    {
        "fromPort": 22,
        "toPort": 22,
        "protocol": "tcp",
        "state": "open",
        "cidrs": [
            "0.0.0.0/0"
        ],
        "cidrListAliases": []
    },
    {
        "fromPort": 443,
        "toPort": 443,
        "protocol": "tcp",
        "state": "open",
        "cidrs": [
            "0.0.0.0/0"
        ],
        "cidrListAliases": []
    }
]
```

If it is a Linux host and has Port 3398 listed, HTTP Port 80 listed or any other ports listed that are not required refer to the remediation below.
If it is a Windows host and has Port 22 listed, HTTP Port 80 listed or any other ports listed that are not required refer to the remediation below.

## Expected Result

Only required ports should be open. SSH (22) should not be open on Windows instances, RDP (3389) should not be open on Linux instances, and HTTP (80) should only be open if properly forwarding to HTTPS (443).

## Remediation

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services`, click `Lightsail` under Compute.
3. This will open up the Lightsail console.
4. Select the `Windows or Linux Instance` you want to review.
5. Go to the Networking section.
6. If it is a Windows instance confirm that SSH has been removed. If it is a Linux instance confirm RDP has been removed.
7. If either ssh(Port 22) is in the Windows system and RDP(Port 3389) is in the Linux system click the bucket icon to delete it.
8. If the server needs HTTP, TCP Port 80 confirm that the application forwards Port 80 to HTTPS, TCP Port 443.
9. If the server does not need HTTP click the bucket icon to delete it.
10. Confirm that there are no other unused or unneeded ports.
11. If the system has other ports that are not required or in use click the bucket icon to delete it.

### Using AWS CLI

1. Run `aws lightsail close-instance-public-ports`

For Windows:

```bash
aws lightsail close-instance-public-ports --instance-name <Windows_Instance_Name> --port-info fromPort=22,protocol=TCP,toPort=22
```

For Linux:

```bash
aws lightsail close-instance-public-ports --instance-name <Linux_Instance_Name> --port-info fromPort=3389,protocol=TCP,toPort=3389
```

For HTTP:

```bash
aws lightsail close-instance-public-ports --instance-name <ANY_Instance_Name> --port-info fromPort=80,protocol=TCP,toPort=80
```

2. Repeat for all instance names identified in the audit that have SSH, RDP or HTTP's open and are not required based on the OS or the use of the system.

## Default Value

Lightsail instances are created with SSH (Port 22) and HTTP (Port 80) open by default for Linux instances, and RDP (Port 3389) and HTTP (Port 80) open by default for Windows instances.

## References

1. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/lightsail/index.html#cli-aws-lightsail

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software - Uninstall or disable unnecessary services on enterprise assets and software, such as an unused file sharing service, web application module, or service function. |      | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running - Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.                                       |      | x    | x    |

## Profile

Level 1 | Manual
