---
name: cis-aws-storage-2.1
description: "Ensure creating EC2 instance with EBS"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, ebs, ec2, block-storage, encryption]
cis_id: "2.1"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-2.2, cis-aws-storage-2.3, cis-aws-storage-2.4, cis-aws-storage-2.5]
prerequisites: []
severity_boost: {}
---

# CIS Control 2.1: Ensure creating EC2 instance with EBS (Manual)

## Profile Applicability

- **Level 2**

## Description

EBS are storage volumes that you attach to Amazon EC2 instances. After you attach a volume to an instance, you can use it in the same way you would use a local hard drive attached to a computer, for example to store files or to install applications.

## Rationale

Amazon EBS (Elastic Block Store) provides persistent block-level storage for EC2 instances, which is essential for:
- Data persistence beyond instance lifecycle
- Ability to detach and reattach volumes to different instances
- Snapshot capability for backup and disaster recovery
- Flexible volume types optimized for different workloads (SSD, HDD)
- Encryption support for data at rest

Properly configuring EC2 instances with EBS ensures data availability, durability, and security.

## Impact

Not properly creating EC2 instances with EBS volumes can lead to:
- Data loss when instances are terminated
- Inability to backup instance data through snapshots
- Performance issues if using instance storage instead of optimized EBS volumes
- Difficulty migrating data between instances
- Lack of encryption for sensitive data at rest

## Audit Procedure

### Via AWS Management Console

**Creating EC2 instance with Volume:**

To create an EC2 instance with a volume in AWS, you can follow these general steps:

1. **Initializing a Secure EC2 Instance**
   - Navigate to the EC2 dashboard within your AWS console. Make sure you're in the region that's right for you
   - Select "Launch Instance"

2. **Naming the EC2 instance**
   - Name your EC2 instance according to the proper naming convention set by your organization

3. **Configure the operating system**
   - You can choose any operating system according to your needs. In this tutorial, Ubuntu is the OS of choice

4. **Create a key pair**
   - Next, create a key pair. You will need this to login your EC2 instance. We're going to log in via SSH
   - Select "Create new key pair". Give your key a name, select RSA encryption, and select Open SSH
   - As you can see by the prompt, you will need to keep the private key that's generated secure on your local computer. This is how you will access your EC2 instance. Select "Create key pair" your secret key will start downloading as a ".pem" file

**Add Storage:**

1. Click "Add New Volume" to add a new volume
2. Specify the volume type (e.g., General Purpose SSD, Provisioned IOPS SSD, Magnetic)
3. Set the size of the volume in GB minimum of 8GB
4. You can add multiple volumes if needed

### Via AWS CLI

```bash
# Launch an EC2 instance with EBS volume
aws ec2 run-instances \
  --image-id ami-xxxxxxxxx \
  --instance-type t2.micro \
  --key-name my-key-pair \
  --security-group-ids sg-xxxxxxxxx \
  --block-device-mappings '[
    {
      "DeviceName": "/dev/sda1",
      "Ebs": {
        "VolumeSize": 20,
        "VolumeType": "gp3",
        "Encrypted": true,
        "DeleteOnTermination": false
      }
    }
  ]'

# List EC2 instances with their EBS volumes
aws ec2 describe-instances \
  --query 'Reservations[].Instances[].[InstanceId,BlockDeviceMappings[]]' \
  --output table

# Describe volumes attached to an instance
aws ec2 describe-volumes \
  --filters Name=attachment.instance-id,Values=i-xxxxxxxxx
```

## Expected Result

- EC2 instances have at least one EBS volume attached
- Volume size is appropriate for workload requirements
- Volume type (gp3, gp2, io1, io2, st1, sc1) matches performance needs
- Encryption is enabled for sensitive workloads
- DeleteOnTermination is set appropriately (false for data volumes, true for temporary storage)

## Remediation

### Via AWS Management Console

1. **Launch New Instance with EBS**
   - Navigate to EC2 → Launch Instance
   - Configure instance details as needed
   - In Storage section:
     - Specify volume size (minimum 8GB)
     - Choose volume type based on workload
     - Enable encryption for data at rest
     - Configure Delete on Termination setting

2. **Add Volume to Existing Instance**
   - Navigate to EC2 → Volumes
   - Create New Volume
   - Attach to running instance

### Via AWS CLI

See audit procedure for creation commands.

## References

1. [Amazon EBS Overview](https://aws.amazon.com/ebs/)
2. [EC2 Instance Storage](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Storage.html)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.11 Encrypt Sensitive Data at Rest | ● | ● | ● |
| v7 | 14.8 Encrypt Sensitive Information at Rest | | ● | |

**CIS Control v8 - 3.11 Encrypt Sensitive Data at Rest:**
Encrypt sensitive data at rest on servers, applications, and databases containing sensitive data. Storage-layer encryption, also known as server-side encryption, meets the minimum requirement of this Safeguard. Additional encryption methods may include application-layer encryption, also known as client-side encryption, where access to the data storage device(s) does not permit access to the plain-text data.

**CIS Control v7 - 14.8 Encrypt Sensitive Information at Rest:**
Encrypt all sensitive information at rest using a tool that requires a secondary authentication mechanism not integrated into the operating system, in order to access the information.

## Notes

- This is a **manual** control requiring verification during EC2 instance creation
- Always enable encryption for EBS volumes containing sensitive data
- Consider using automated snapshots for backup
- Choose appropriate volume types based on IOPS and throughput requirements
- Set DeleteOnTermination=false for data volumes to prevent accidental data loss
