---
name: cis-aws-euc-2.10
description: "Ensure that patches and updates are performed on the operating system for Workstations"
category: cis-end-user-compute
version: "1.2.0"
author: cyberstrike-official
tags: [cis, aws, end-user-compute, workspaces, patching, updates, maintenance-mode]
cis_id: "2.10"
cis_benchmark: "CIS AWS End User Compute Services Benchmark v1.2.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-euc-2.9]
prerequisites: []
severity_boost: {}
---

# Ensure that patches and updates are performed on the operating system for Workstations (Automated)

## Profile Applicability

- Level 1

## Description

In order for Windows updates to occur auto-stop WorkSpaces must be utilized and the default for maintenance mode must be set to enabled.

## Rationale

Windows Operating systems updates can be a high security vulnerability and normal updates and patches can help eliminate these vulnerabilities.

## Impact

None specified in the benchmark.

## Audit Procedure

### Using AWS Console

Perform the steps to check maintenance mode for your WorkSpaces:

1. Login to the WorkSpaces console at https://console.aws.amazon.com/workspaces/
2. In the left pane, click **Directories**
3. Select your directory id link
4. Scroll to the **Maintenance mode** section and ensure maintenance mode is set to **Enabled**

If it is set to **Enabled** you are meeting this recommendation.

If it is set to **Disabled**, refer to the remediation below.

### Using AWS CLI

1. Run the workspaces command `describe-workspace-directories`:

```bash
aws workspaces describe-workspace-directories
```

2. Review the output under "WorkspaceCreationProperties" for "EnableMaintenanceMode": true

## Expected Result

The output should show `"EnableMaintenanceMode": true` in the WorkspaceCreationProperties section.

Example output:

```json
"WorkspaceCreationProperties": {
  "EnableInternetAccess": false,
  "EnableWorkDocs": true,
  "UserEnabledAsLocalAdministrator": true,
  "EnableMaintenanceMode": true
}
```

## Remediation

### Using AWS Console

Perform the following steps to enable maintenance mode:

1. Login to the WorkSpaces console at https://console.aws.amazon.com/workspaces/
2. In the left pane, click **Directories**
3. Select your directory id link
4. Scroll to the **Maintenance mode** section and click **Edit**
5. Select **Enable maintenance mode**
6. Click **Save**

**Note:**
If you prefer to manage updates manually or with another tool document usage of that, and choose Disabled.

### Using AWS CLI

1. Run the WorkSpaces modify-workspace-creation-property command:

```bash
aws workspaces modify-workspace-creation-property --resource-id <directory_id> --workspace-creation-properties EnableMaintenanceMode=true
```

## Default Value

By default, your Windows WorkSpaces are configured to receive updates from Windows Update. To configure your own automatic update mechanisms for Windows, see the documentation for Windows Server Update Services (WSUS) and Configuration Manager.

https://docs.aws.amazon.com/workspaces/latest/adminguide/workspace-maintenance.html

## References

1. https://docs.aws.amazon.com/workspaces/latest/adminguide/workspace-maintenance.html
2. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/workspaces/modify-workspace-creation-properties.html

## CIS Controls

**v8:**

- 2.2 Ensure Authorized Software is Currently Supported
  - Ensure that only currently supported software is designated as authorized in the software inventory for enterprise assets. If software is unsupported, yet necessary for the fulfillment of the enterprise's mission, document an exception detailing mitigating controls and residual risk acceptance. For any unsupported software without an exception documentation, designate as unauthorized. Review the software list to verify software support at least monthly, or more frequently.

**v7:**

- 2.2 Ensure Software is Supported by Vendor
  - Ensure that only software applications or operating systems currently supported by the software's vendor are added to the organization's authorized software inventory. Unsupported software should be tagged as unsupported in the inventory system.
