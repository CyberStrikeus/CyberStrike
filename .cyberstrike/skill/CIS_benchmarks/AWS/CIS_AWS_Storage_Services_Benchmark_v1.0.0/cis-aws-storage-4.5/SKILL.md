---
name: cis-aws-storage-4.5
description: "Ensure installation and configuration of Lustre Client"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, fsx, lustre, client-installation, ubuntu, level-2]
cis_id: "4.5"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws, linux]
cwe_ids: []
chains_with: [cis-aws-storage-4.2, cis-aws-storage-4.4, cis-aws-storage-4.6]
prerequisites: [cis-aws-storage-4.2, cis-aws-storage-4.4]
severity_boost: {}
---

# 4.5 Ensure installation and configuration of Lustre Client (Manual)

## Profile Applicability
- Level 2

## Description

To utilize the newly created File Cache, you must install the Lustre Client on your EC2 instance.

## Rationale

The Lustre Client facilitates efficient communication between the EC2 instance and the File Cache, ensuring high-performance data access and improved overall system efficiency. This setup is crucial for optimizing data processing and leveraging the benefits of the File Cache.

## Impact

Without the Lustre Client installed, EC2 instances cannot mount or access the FSx File Cache, resulting in inability to leverage the high-performance caching capabilities and potential performance degradation for data-intensive workloads.

## Audit Procedure

### AWS Console

This is a client-side configuration that cannot be audited through the AWS Console. Use SSH to connect to EC2 instances and verify Lustre client installation.

### AWS CLI & SSH

1. Connect to your EC2 instance:
```bash
ssh -i "{KEY.pem}" ubuntu@{your-ec2-instance}
```

2. Verify Lustre client installation:
```bash
# Check if Lustre client is installed
dpkg -l | grep lustre

# Check Lustre client version
modinfo lustre

# Verify kernel compatibility
uname -r
```

## Expected Result

The Lustre client should be properly installed with:
- Lustre client modules present in the system
- Compatible kernel version (5.15.0.1020-aws or later for Ubuntu 22.02)
- Lustre repository configured
- Client modules loaded and available

## Remediation

### SSH to EC2 Instance

Follow these steps to install the Lustre Client on Ubuntu 22.04:

1. **Launch your EC2 instance.** Navigate to the folder of your secure key and ssh into the instance using this command:
```bash
ssh -i "{KEY.pem}" ubuntu@{your-ec2-instance}
```

2. When prompted to log in with the SSH key, enter "yes"

3. You should now be connected to your EC2 instance

4. **Run the following command to download and install the public Lustre key:**
```bash
wget -O - https://fsx-lustre-client-repo-public-keys.s3.amazonaws.com/fsx-ubuntu-public-key.asc | gpg --dearmor | sudo tee /usr/share/keyrings/fsx-ubuntu-public-key.gpg >/dev/null
```

5. **Add the AWS Lustre package repository to your local package manager using the following command:**
```bash
sudo bash -c 'echo "deb [signed-by=/usr/share/keyrings/fsx-ubuntu-public-key.gpg] https://fsx-lustre-client-repo.s3.amazonaws.com/ubuntu jammy main" > /etc/apt/sources.list.d/fsxlustreclientrepo.list && apt-get update'
```

6. **Determine which kernel is currently running on your client instance and update as needed.** The AWS Lustre client on Ubuntu 22.02 requires kernel 5.15.0.1020-aws or later for both x86 based EC2 instances and Arm-based EC2 instanced powered by AWS Graviton processors:

   a. Run the following command to find out which kernel your machine is running:
   ```bash
   uname -r
   ```

   b. If your kernel is not up to date, run the following command to install the kernel update, Lustre client update, and reboot your system:
   ```bash
   sudo apt install -y linux-aws lustre-client-modules-aws && sudo reboot
   ```

   c. If your kernel is up to date and you just want to install the latest Lustre version, run this command:
   ```bash
   sudo apt install -y lustre-client-modules-$(uname -r)
   ```

7. **Verify installation:**
```bash
# Check installed packages
dpkg -l | grep lustre

# Verify Lustre module
modinfo lustre

# Check if module can be loaded
sudo modprobe lustre
```

## Default Value

By default, the Lustre client is not installed on EC2 instances. It must be explicitly installed on compatible operating systems.

## References

1. https://docs.aws.amazon.com/fsx/latest/LustreGuide/install-lustre-client.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists<br/>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | ● | ● | ● |
| v8 | 14.2 Train Workforce Members to Recognize Social Engineering Attacks<br/>Train workforce members to recognize social engineering attacks, such as phishing, pre-texting, and tailgating. | ● | ● | ● |
| v7 | 5.2 Maintain Secure Images<br/>Maintain secure images or templates for all systems in the enterprise based on the organization's approved configuration standards. Any new system deployment or existing system that becomes compromised should be imaged using one of those images or templates. | | ● | ● |
| v7 | 13.4 Only Allow Access to Authorized Cloud Storage or Email Providers<br/>Only allow access to authorized cloud storage or email providers. | | ● | ● |

## Profile
Level 2
