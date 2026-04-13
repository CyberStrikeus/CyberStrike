---
name: cis-aws-euc-2.8
description: "Ensure the default IP access control group is disassociated"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, workspaces, ip-access-control, firewall, network-security]
cis_id: "2.8"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-euc-2.7, cis-aws-euc-2.9]
prerequisites: []
severity_boost: {}
---

# Ensure the default IP access control group is disassociated (Automated)

## Profile Applicability
- Level 1

## Description
The default IP Access Control group allows all traffic. Once you create and attach an IP Access Control Group the default is disassociated.

## Rationale
IP Access Control group acts as a virtual firewall for your WorkSpaces allowing you to add your trusted networks.

## Impact
IP access control groups do not allow the use of dynamic IP addresses when using a NAT gateway and additional configuration has to be considered.

## Audit Procedure

### Using AWS Console

Perform the following steps to review your Directory:

1. Login to the WorkSpaces console at https://console.aws.amazon.com/workspaces/
2. In the left pane, click **Directories**
3. Select your directory id link
4. Scroll to the **IP access control groups** section and click **Edit**
5. Confirm that you have an IP Access Control Group Associated with this Directory
6. Make note of the **name(s)** of the IP Access Control Group
7. Next review the IP Access Control Group
8. In the navigation pane, click **IP Access Controls**
9. Select the name of the **IP Access Control Group(s)** you record from the Directory
10. For each IP Access Control Group confirm the source IP address or IP address range, and the Description

If an IP Access Control group doesn't exist follow the remediation below.

### Using AWS CLI

Run the `describe-ip-groups` command:

```bash
aws workspaces describe-ip-groups
```

Review the output for the name and the IP Access controls.

If an IP Access Control group doesn't exist refer to the remediation below.

## Remediation

### Using AWS Console

Perform the steps below to create an IP Access control group:

1. Login to the WorkSpaces console at https://console.aws.amazon.com/workspaces/
2. In the left pane, Click **IP Access Controls**
3. Click **Create IP Group**
4. In the **Create IP Group** dialog box, enter a name and description for the group
5. Click **Create**
6. Select the group
7. Click **Edit**
8. For each IP address, click **Add Rule**
9. For Source, enter the IP address or IP address range
10. For Description, enter a description

When you are done adding rules,

11. Click **Save**

**Next Associate an IP Access Control Group with a Directory**

1. Login to the WorkSpaces console at https://console.aws.amazon.com/workspaces/
2. In the left pane, click **Directories**
3. Select the directory id link
4. Scroll to the **IP access control groups** section and click **Edit**
5. Select the IP access control group and click **Associate**

**Note:** If you associate an IP access control group that has no rules with a directory, this blocks all access to all WorkSpaces.

### Using AWS CLI

Run the `create-ip-group` command:

```bash
aws workspaces create-ip-group --group-name name-of-group --user-rules ipRule=ipaddress_list
```

Associate an IP Access Control Group with a Directory

Run the 'associate-ip-groups' command:

```bash
aws workspaces associate-ip-groups --directory-id directory_ID --group-ids IDs_of_IP_access_ctrl_group
```

## Default Value
By default, this default group includes a default rule that allows users to access their WorkSpaces from anywhere. You cannot modify the default IP access control group for your directory. If you don't associate an IP access control group with your directory, the default group is used. If you associate an IP access control group with a directory, the default IP access control group is disassociated.

https://docs.aws.amazon.com/workspaces/latest/adminguide/amazon-workspaces-ip-access-control-groups.html

## References
1. https://docs.aws.amazon.com/workspaces/latest/adminguide/amazon-workspaces-ip-access-control-groups.html
2. https://docs.aws.amazon.com/cli/latest/reference/workspaces/create-ip-group.html
3. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/workspaces/index.html#cli-aws-workspaces

## CIS Controls
**v8:**
- 3.3 Configure Data Access Control Lists
  - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.

**v7:**
- 14.6 Protect Information through Access Control Lists
  - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.
