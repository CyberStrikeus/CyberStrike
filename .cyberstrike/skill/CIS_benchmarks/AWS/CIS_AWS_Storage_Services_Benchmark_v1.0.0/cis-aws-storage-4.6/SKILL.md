---
name: cis-aws-storage-4.6
description: "Ensure EC2 Kernel compatibility with Lustre"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, fsx, lustre, kernel, compatibility, ubuntu, level-2]
cis_id: "4.6"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws, linux]
cwe_ids: []
chains_with: [cis-aws-storage-4.5, cis-aws-storage-4.7]
prerequisites: [cis-aws-storage-4.2, cis-aws-storage-4.5]
severity_boost: {}
---

# 4.6 Ensure EC2 Kernel compatibility with Lustre (Manual)

## Profile Applicability
- Level 2

## Description

The latest kernel included with the Ubuntu Amazon EC2 AMI is not compatible with the Lustre service, which is crucial for mounting the cache on your EC2 instance. To downgrade your kernel, specific prerequisites must be met if you are using the default Ubuntu machine image as of November 8, 2023.

## Rationale

The latest kernel version is not supported by Lustre, and meeting the prerequisites for downgrading will allow you to leverage Lustre's high-performance file system capabilities effectively. This ensures optimal data access and processing efficiency on your EC2 instance.

## Impact

Using an incompatible kernel version will prevent the Lustre client from functioning properly, resulting in inability to mount FSx File Cache and loss of high-performance file system capabilities.

## Audit Procedure

### SSH to EC2 Instance

1. Connect to your EC2 instance:
```bash
ssh -i "{KEY.pem}" ubuntu@{your-ec2-instance}
```

2. **Check current kernel version:**
```bash
uname -r
```

3. **List available Lustre packages and verify compatible kernel:**
```bash
sudo apt-cache search lustre-client-modules
```

4. **Verify the most recent compatible version:**
   - The output will show a list of supported modules with corresponding kernel order from top to bottom
   - The most recent version should be similar to "lustre-client-modules-5.15.0-1049-aws"
   - Ensure this matches the kernel requirements (5.15.0.1020-aws or later for Ubuntu 22.02)

## Expected Result

The EC2 instance should be running a kernel version compatible with Lustre:
- For Ubuntu 22.02: kernel 5.15.0-1049-aws or compatible version
- Lustre client modules available for the current kernel version
- Kernel version supports both x86 based EC2 instances and Arm-based EC2 instances powered by AWS Graviton processors

## Remediation

### SSH to EC2 Instance

Follow the steps to downgrade your kernel to a Lustre-compatible version:

1. **List all of the available Lustre packages:**
```bash
sudo apt-cache search lustre-client-modules
```
   - This will show a list of supported modules with corresponding kernel order from top to bottom
   - The most recent version in this case is "lustre-client-modules-5.15.0-1049-aws"
   - Save this information for the next commands

2. **Install the most recent linux image that supports the Lustre client:**
```bash
sudo apt-get install -y linux-image-5.15.0-1049-aws
sudo sed -i 's/GRUB_DEFAULT=.\+/GRUB_DEFAULT="Advanced options for Ubuntu>Ubuntu, with Linux 5.15.0-1049-aws"/' /etc/default/grub
```

3. **Reboot your system:**
```bash
sudo reboot
```

4. **After reboot, reconnect and install the correct Lustre module:**
```bash
ssh -i "{KEY.pem}" ubuntu@{your-ec2-instance}
sudo apt-get install -y lustre-client-modules-$(uname -r)
```

5. **Verify installation:**
```bash
# Confirm kernel version
uname -r

# Verify Lustre module installation
dpkg -l | grep lustre

# Check if Lustre module can be loaded
sudo modprobe lustre
lsmod | grep lustre
```

## Default Value

The default Ubuntu AMI includes the latest kernel which may not be compatible with Lustre. Manual kernel downgrade is required for Lustre compatibility.

## References

1. https://docs.aws.amazon.com/fsx/latest/LustreGuide/install-lustre-client.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts<br/>Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account. | ● | ● | ● |
| v8 | 13.11 Tune Security Event Alerting Thresholds<br/>Tune security event alerting thresholds monthly, or more frequently. | | | ● |
| v7 | 5.2 Maintain Secure Images<br/>Maintain secure images or templates for all systems in the enterprise based on the organization's approved configuration standards. Any new system deployment or existing system that becomes compromised should be imaged using one of those images or templates. | | ● | ● |
| v7 | 13.4 Only Allow Access to Authorized Cloud Storage or Email Providers<br/>Only allow access to authorized cloud storage or email providers. | | ● | ● |

## Profile
Level 2
