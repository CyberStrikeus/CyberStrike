---
name: cis-aws-storage-4.7
description: "Ensure mounting FSx cache"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, fsx, lustre, mount, file-system, level-2]
cis_id: "4.7"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws, linux]
cwe_ids: []
chains_with: [cis-aws-storage-4.5, cis-aws-storage-4.6, cis-aws-storage-4.8]
prerequisites: [cis-aws-storage-4.4, cis-aws-storage-4.5, cis-aws-storage-4.6]
severity_boost: {}
---

# 4.7 Ensure mounting FSx cache (Manual)

## Profile Applicability

- Level 2

## Description

Mounting the FSx cache is a crucial step to optimize data retrieval and system performance. This process involves connecting the FSx file system to your compute instances, allowing them to access cached data efficiently. Properly mounting the FSx cache ensures low-latency access to frequently used data, enhances overall application performance, and leverages the full capabilities of the AWS FSx service. This setup is essential for achieving high performance and efficient data processing in your AWS environment.

## Rationale

By connecting the FSx file system to your compute instances, you enable low-latency access to frequently used data, significantly improving application performance. This setup leverages the full capabilities of the AWS FSx service, ensuring efficient data processing and resource utilization in your AWS environment. Properly mounting the FSx cache is essential for achieving high performance and operational efficiency.

## Impact

Without properly mounting the FSx cache, compute instances cannot access the cached data, resulting in inability to benefit from the high-performance caching layer and potential degradation in application performance and data access times.

## Audit Procedure

### SSH to EC2 Instance

1. Connect to your EC2 instance:

```bash
ssh -i "{KEY.pem}" ubuntu@{your-ec2-instance}
```

2. **Verify mount point exists:**

```bash
ls -ld /mnt
```

3. **Check if FSx cache is already mounted:**

```bash
df -h | grep /mnt
mount | grep lustre
```

4. **Verify the mount configuration:**

```bash
# Check if the path shows up in the file system
ls -la /mnt

# Verify DNS name is resolvable
nslookup <cache_dns_name>

# Check VPC connectivity
# Ensure EC2 instance is in the same VPC as the cache
```

## Expected Result

The FSx cache should be properly mounted with:

- Mount point directory created (`/mnt` or custom path)
- FSx cache mounted to the mount point using Lustre protocol
- Mount point accessible and visible in file system (`df -h`, `mount`)
- EC2 instance in the same VPC as the FSx cache
- DNS name resolvable and mount name correct

## Remediation

### SSH to EC2 Instance

To mount your cache, follow the next steps:

1. **Make a directory for the mount point:**

```bash
sudo mkdir -p /mnt
```

2. **Mount the Amazon file cache to the directory that you just created.** Use the following command and replace these names:
   - Replace `cache_dns_name` with the actual file cache's Domain Name System (DNS) name
   - Replace `mountname` with the cache's mount name, which you can get by running the `describe-file-caches` AWS CLI command or `DescribeFileCaches` API operation

```bash
sudo mount -t lustre -o relatime,flock cache_dns_name@tcp:/mountname /mnt
```

**Note:** Make sure your EC2 instance is in the same VPC as your cache.

3. **Verify the mount:**

```bash
# If done correctly, the path of your folder will show up in the /mnt folder
df -h
ls -la /mnt

# You can also use the df command to see the DNS and mount point is attached to your file system:
df -h | grep /mnt
```

### AWS CLI (to retrieve mount information)

```bash
# Get cache DNS name and mount name
aws fsx describe-file-caches --file-cache-ids <cache-id> \
  --query 'FileCaches[0].[DNSName,LustreConfiguration.MountName]' \
  --output text

# Get cache details including VPC information
aws fsx describe-file-caches --file-cache-ids <cache-id> \
  --query 'FileCaches[0].[DNSName,VpcId,SubnetIds]'
```

## Default Value

By default, FSx cache is not mounted on EC2 instances. Manual mounting is required after cache creation and Lustre client installation.

## References

1. https://docs.aws.amazon.com/fsx/latest/LustreGuide/mounting-from-lustre-client.html

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v7               | 3.3 Protect Dedicated Assessment Accounts<br/>Use a dedicated account for authenticated vulnerability scans, which should not be used for any other administrative activities and should be tied to specific machines at specific IP addresses.                                                                                                                                           |      | ●    | ●    |
| v7               | 5.2 Maintain Secure Images<br/>Maintain secure images or templates for all systems in the enterprise based on the organization's approved configuration standards. Any new system deployment or existing system that becomes compromised should be imaged using one of those images or templates.                                                                                         |      | ●    | ●    |
| v7               | 6.4 Ensure adequate storage for logs<br/>Ensure that all systems that store logs have adequate storage space for the logs generated.                                                                                                                                                                                                                                                      |      | ●    | ●    |
| v7               | 8.3 Enable Operating System Anti-Exploitation Features/ Deploy Anti-Exploit Technologies<br/>Enable anti-exploitation features such as Data Execution Prevention (DEP) or Address Space Layout Randomization (ASLR) that are available in an operating system or deploy appropriate toolkits that can be configured to apply protection to a broader set of applications and executables. |      | ●    | ●    |

## Profile

Level 2
