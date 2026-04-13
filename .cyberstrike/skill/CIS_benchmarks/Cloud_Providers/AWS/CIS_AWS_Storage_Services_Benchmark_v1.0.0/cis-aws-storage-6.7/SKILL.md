---
name: cis-aws-storage-6.7
description: "Ensure proper configuration of the Launch Settings"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, edr, launch-settings, ec2, configuration, startup]
cis_id: "6.7"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-6.6, cis-aws-storage-6.8]
prerequisites: []
severity_boost: {}
---

# CIS 6.7: Ensure proper configuration of the Launch Settings (Manual)

## Profile Applicability

- **Level:** 2

## Description

Set up and verify the launch settings to ensure systems and applications start correctly and securely. This includes defining startup parameters, specifying required resources, and configuring security settings to prevent unauthorized changes. Regularly review and update these settings to align with best practices and organizational requirements, ensuring optimal performance and security at launch.

## Rationale

Proper configuration of launch settings is crucial for ensuring that systems and applications start securely and perform optimally. Defining startup parameters and resource requirements prevents potential issues and enhances efficiency. Regular reviews and updates of these settings help maintain alignment with best practices and evolving organizational needs, thereby strengthening security and operational reliability from the moment of launch.

## Impact

Launch settings configuration affects:

- System startup behavior
- Resource allocation
- Security posture at launch
- Recovery instance performance
- Operational reliability

Note: The settings can be changed after instances have been launched, but a new instance must be launched for new launch settings to take effect.

## Audit Procedure

### Via AWS Console

1. **Select Launch Settings:**
   - Select launch settings on the source server page

2. **Configure Launch Settings:**
   - On the launch settings page, next to general launch, select "edit"

3. **Configure EC2 Launch Template:**
   - Enable auto assign public IP and change the instance type to a t2.medium

4. **Set Version to Default:**
   - Set version to default in the console

5. **Set Default Version:**
   - Set the default version that was just created to default version

6. **Return to Dashboard:**
   - Return to the dashboard and confirm your configurations are correct.

## Expected Result

- Launch settings accessible from source server page
- General launch settings configured
- EC2 launch template configured with:
  - Auto-assign public IP enabled
  - Instance type set to t2.medium (or appropriate size)
- Default version set in console
- New version created and set as default
- Configurations verified and confirmed correct
- Settings documented

## Remediation

### Via AWS Console

1. **Access Launch Settings:**
   - Navigate to source server page
   - Select launch settings

2. **Edit General Launch:**
   - Click "edit" next to general launch

3. **Configure EC2 Template:**
   - Enable auto assign public IP
   - Change instance type to t2.medium (or appropriate size for workload)

4. **Set Version:**
   - Set version to default in the console
   - Confirm the default version setting

5. **Verify Configuration:**
   - Return to the dashboard
   - Confirm all configurations are correct
   - Document the settings

6. **Note:**
   - Remember that a new instance must be launched for new launch settings to take effect
   - Plan instance launches accordingly

## Default Value

By default, launch settings are not configured. Organizations must manually configure startup parameters, resource allocations, and security settings.

## References

- [AWS Elastic Disaster Recovery Launch Settings](https://docs.aws.amazon.com/drs/latest/userguide/launch-settings.html)
- [AWS EC2 Launch Templates](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-launch-templates.html)

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.2 Establish and Maintain a Secure Configuration Process for Network Infrastructure<br/>Establish and maintain a secure configuration process for network devices. Review and update documentation annually, or when significant enterprise changes occur that could impact this Safeguard.                                                                                                                                                    | ●    | ●    | ●    |
| v8               | 16.7 Use Standard Hardening Configuration Templates for Application Infrastructure<br/>Use standard, industry-recommended hardening configuration templates for application infrastructure components. This includes underlying servers, databases, and web servers, and applies to cloud containers, Platform as a Service (PaaS) components, and SaaS components. Do not allow in-house developed software to weaken configuration hardening. |      | ●    | ●    |
| v7               | 5.2 Maintain Secure Images<br/>Maintain secure images or templates for all systems in the enterprise based on the organization's approved configuration standards. Any new system deployment or existing system that becomes compromised should be imaged using one of those images or templates.                                                                                                                                               |      | ●    | ●    |
| v7               | 5.4 Deploy System Configuration Management Tools<br/>Deploy system configuration management tools that will automatically enforce and redeploy configuration settings to systems at regularly scheduled intervals.                                                                                                                                                                                                                              |      | ●    | ●    |

## Profile

- Level 2
