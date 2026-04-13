---
name: cis-aws-storage-2.3
description: "Ensure the proper configuration of EBS storage"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, ebs, encryption, kms, volume-configuration]
cis_id: "2.3"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: [CWE-311]
chains_with: [cis-aws-storage-2.1, cis-aws-storage-2.4, cis-aws-storage-2.5]
prerequisites: [cis-aws-storage-2.1]
severity_boost: {}
---

# CIS Control 2.3: Ensure the proper configuration of EBS storage (Manual)

## Profile Applicability

- **Level 2**

## Description

All computer instances need to have a device on which to store files. EBS is built on top of EC2 instances as a block storage device.

## Rationale

Remember that we are working with cloud computing. Rather than purchasing and manually installing disk drives on a server, AWS allows you to virtually add storage using Elastic Block Store (EBS).

Proper EBS configuration is essential for:

- Data integrity and persistence
- Performance optimization
- Cost-effectiveness
- Security (encryption)
- Disaster recovery capability
- Operational reliability

## Impact

Failure to properly configure EBS storage can lead to data loss, performance issues, increased costs, security vulnerabilities, and operational downtime. Ensuring correct configuration is crucial to maintain data integrity, efficiency, cost-effectiveness, security, and reliability.

## Audit Procedure

### Via AWS Management Console

1. **Open the Amazon EC2 Console**
   - Navigate to the EC2 Dashboard in the AWS Management Console

2. **Select Volumes**
   - Under the "Elastic Block Store" section, select "Volumes"

3. **Create Volume**
   - Click on "Create Volume"
   - Choose the volume type (e.g., General Purpose SSD (gp2), Provisioned IOPS SSD (io1), etc.)
   - Specify the size and availability zone
   - Optionally, configure additional settings such as IOPS, encryption, and tags

4. **Attach Volume to Instance**
   - Select the volume you created
   - Click on "Actions" and choose "Attach Volume"
   - Select the instance to which you want to attach the volume and specify the device name

5. **Format and Mount the Volume (on the instance)**
   - Connect to your instance using SSH
   - List available disks using the command: `lsblk`
   - Format the new volume (e.g., `sudo mkfs -t ext4 /dev/xvdf` for ext4 filesystem)
   - Create a mount point (e.g., `sudo mkdir /mnt/data`)
   - Mount the volume (e.g., `sudo mount /dev/xvdf /mnt/data`)

6. **Configure Automatic Mounting (optional)**
   - Edit the `/etc/fstab` file to add an entry for the new volume to ensure it mounts automatically on reboot
   - Example entry: `/dev/xvdf /mnt/data ext4 defaults,nofail 0 2`

### Via AWS CLI

```bash
# List all EBS volumes
aws ec2 describe-volumes \
  --query 'Volumes[].[VolumeId,Size,VolumeType,State,Encrypted]' \
  --output table

# Check for unencrypted volumes
aws ec2 describe-volumes \
  --filters Name=encrypted,Values=false \
  --query 'Volumes[].[VolumeId,Size,State]' \
  --output table

# Get volume details including IOPS and throughput
aws ec2 describe-volumes \
  --volume-ids vol-xxxxxxxxx

# Check if volumes have appropriate tags
aws ec2 describe-volumes \
  --query 'Volumes[?Tags==`null`].[VolumeId,Size]' \
  --output table
```

## Expected Result

- Volumes are properly sized for workload requirements
- Volume types match performance needs (gp3/gp2 for general use, io1/io2 for high IOPS)
- Encryption is enabled for volumes containing sensitive data
- Volumes are attached to appropriate instances
- Delete on Termination is configured appropriately
- Volumes are properly tagged for management and cost tracking

## Remediation

### Via AWS Management Console

Follow the audit procedure steps above to:

1. Create volumes with appropriate configuration
2. Enable encryption for sensitive data
3. Choose correct volume type for workload
4. Configure IOPS and throughput settings
5. Set up automatic mounting where needed

### Via AWS CLI

```bash
# Create encrypted EBS volume
aws ec2 create-volume \
  --volume-type gp3 \
  --size 100 \
  --encrypted \
  --kms-key-id arn:aws:kms:region:account:key/key-id \
  --availability-zone us-east-1a \
  --tag-specifications 'ResourceType=volume,Tags=[{Key=Name,Value=DataVolume},{Key=Environment,Value=Production}]'

# Modify volume type (requires volume to be in available state or attached to running instance)
aws ec2 modify-volume \
  --volume-id vol-xxxxxxxxx \
  --volume-type gp3 \
  --iops 3000 \
  --throughput 125

# Enable encryption for existing volume (requires snapshot and recreation)
# 1. Create snapshot
aws ec2 create-snapshot --volume-id vol-xxxxxxxxx --description "Pre-encryption snapshot"

# 2. Copy snapshot with encryption
aws ec2 copy-snapshot \
  --source-snapshot-id snap-xxxxxxxxx \
  --source-region us-east-1 \
  --encrypted \
  --kms-key-id arn:aws:kms:region:account:key/key-id

# 3. Create new encrypted volume from encrypted snapshot
aws ec2 create-volume \
  --snapshot-id snap-yyyyyyyyy \
  --availability-zone us-east-1a
```

## Default Value

By default, new EBS volumes are not encrypted unless you enable encryption by default in your AWS account settings.

## References

1. [Amazon EBS Volumes](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ebs-volumes.html)
2. [Amazon EBS Encryption](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EBSEncryption.html)

## CIS Controls

| Controls Version | Control                                                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 4.2 Establish and Maintain a Secure Configuration Process for Network Infrastructure | ●    | ●    | ●    |
| v7               | 11.1 Maintain Standard Security Configurations for Network Devices                   |      | ●    | ●    |

**CIS Control v8 - 4.2 Establish and Maintain a Secure Configuration Process for Network Infrastructure:**
Establish and maintain a secure configuration process for network devices. Review and update documentation annually, or when significant enterprise changes occur that could impact this Safeguard.

**CIS Control v7 - 11.1 Maintain Standard Security Configurations for Network Devices:**
Maintain standard, documented security configuration standards for all authorized network devices.

## Notes

- This is a **manual** control requiring configuration verification
- By following these steps, you can effectively configure and manage EBS storage for your AWS instances
- Enable EBS encryption by default for your AWS account to ensure all new volumes are encrypted
- Use AWS Config rules to monitor EBS encryption compliance
- Consider using gp3 volumes for better performance and cost optimization
- Regularly review volume utilization to avoid over-provisioning
