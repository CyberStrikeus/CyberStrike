---
name: cis-aws-storage-2.4
description: "Ensure the creation of a new volume"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, ebs, encryption, kms, data-protection, delete-on-termination]
cis_id: "2.4"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: [CWE-311, CWE-404]
chains_with: [cis-aws-storage-2.3, cis-aws-storage-2.5]
prerequisites: [cis-aws-storage-2.1]
severity_boost: {}
---

# CIS Control 2.4: Ensure the creation of a new volume (Manual)

## Profile Applicability

- **Level 2**

## Description

Leave the root volume unchanged and create a new volume. To ensure the security of the instance and prevent data loss, select "no" under the "delete on termination" option and encrypt your volume using AWS KMS. A default key is available for encrypting the volume.

## Rationale

By leaving the root volume unchanged and creating a new volume, you separate critical data from the operating system. Selecting "no" for the "delete on termination" option ensures that data on the new volume is not automatically deleted when the instance is terminated, protecting against accidental data loss. Encrypting the volume using AWS KMS adds an additional layer of security, safeguarding the data against unauthorized access. The use of a default key for encryption simplifies the process while maintaining strong security measures.

## Impact

Not following these steps can lead to data loss, security risks, operational disruptions, and prolonged recovery times. Setting "delete on termination" to "no" prevents data deletion upon instance termination, while encrypting the volume with AWS KMS protects against unauthorized access. Storing critical data separately from the root volume ensures operational continuity and easier recovery.

## Audit Procedure

### Via AWS Management Console

To audit this configuration in AWS, follow these steps:

1. **Access the AWS Management Console**
   - Log in to your AWS account and navigate to the AWS Management Console

2. **Review EBS Volumes**
   - Go to the EC2 Dashboard and select "Volumes" under the "Elastic Block Store" section
   - Check the properties of each volume to ensure that the root volume is unchanged and new volumes are created as needed

3. **Check "Delete on Termination" Setting**
   - In the "Volumes" section, select each volume and click on the "Actions" button
   - Select "Modify Volume" and ensure that "Delete on Termination" is set to "no" for the critical volumes

4. **Verify Encryption**
   - In the "Volumes" section, check the "Encrypted" column to confirm that the volumes are encrypted
   - For detailed information, select a volume and view its details to ensure it is encrypted using AWS KMS

5. **Review IAM Policies**
   - Navigate to the IAM Dashboard and review the policies attached to users, groups, and roles to ensure they have appropriate permissions to create, modify, and encrypt EBS volumes

6. **Use AWS Config**
   - Enable AWS Config to continuously monitor and record AWS resource configurations
   - Create AWS Config rules to check for compliance with best practices, such as ensuring volumes are encrypted and "Delete on Termination" is set to "no"

7. **Generate Reports**
   - Use AWS CloudTrail to review logs of API calls made to EBS volumes, ensuring compliance with the required configurations
   - Generate compliance reports using AWS Config and AWS CloudTrail to provide evidence of adherence to best practices

### Via AWS CLI

```bash
# Check EBS volumes and their delete on termination status
aws ec2 describe-instances \
  --query 'Reservations[].Instances[].[InstanceId,BlockDeviceMappings[]]' \
  --output json

# Check for volumes with DeleteOnTermination=true
aws ec2 describe-instances \
  --query 'Reservations[].Instances[].BlockDeviceMappings[?Ebs.DeleteOnTermination==`true`]' \
  --output json

# Verify encryption status
aws ec2 describe-volumes \
  --query 'Volumes[].[VolumeId,Encrypted,KmsKeyId]' \
  --output table

# Check specific volume configuration
aws ec2 describe-volumes --volume-ids vol-xxxxxxxxx
```

## Expected Result

- Root volume remains unmodified
- Additional data volumes are created separately
- Delete on Termination is set to "no" for data volumes
- Volumes containing sensitive data are encrypted with AWS KMS
- KMS keys are properly configured and rotated

## Remediation

### Via AWS Management Console

1. **Volume Configurations**
   - After configuring your volume, ensure the settings meet your requirements
   - To secure your file system and prevent data loss, verify that the "Delete on Termination" option is set to "no," the volume is encrypted, and the KMS key is correctly specified
   - For this EBS instance, we are using the default KMS key

2. **Availability Zone Consistency**
   - Ensure your EBS volume is in the same Availability Zone as your EC2 instance
   - An EBS volume can only be attached to an EC2 instance within the same Availability Zone
   - You can mount and unmount EBS volumes to any EC2 instance within the same zone as needed

### Via AWS CLI

```bash
# Modify instance attribute to disable DeleteOnTermination
aws ec2 modify-instance-attribute \
  --instance-id i-xxxxxxxxx \
  --block-device-mappings '[{
    "DeviceName": "/dev/sdf",
    "Ebs": {
      "DeleteOnTermination": false
    }
  }]'

# Create a new encrypted volume
aws ec2 create-volume \
  --volume-type gp3 \
  --size 100 \
  --encrypted \
  --kms-key-id arn:aws:kms:region:account:key/key-id \
  --availability-zone us-east-1a

# Attach volume to instance
aws ec2 attach-volume \
  --volume-id vol-xxxxxxxxx \
  --instance-id i-xxxxxxxxx \
  --device /dev/sdf
```

## Default Value

By default, root volumes have DeleteOnTermination set to true, while additional volumes have it set to false. Encryption is not enabled by default.

## References

1. [Amazon EBS Volumes](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ebs-volumes.html)
2. [Amazon EBS Encryption](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EBSEncryption.html)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 4.2 Establish and Maintain a Secure Configuration Process for Network Infrastructure | ● | ● | ● |
| v7 | 11.1 Maintain Standard Security Configurations for Network Devices | | ● | ● |

## Notes

- This is a **manual** control requiring configuration review
- By following these steps, you can effectively audit your EBS configurations to ensure data security, integrity, and operational reliability
- Always create separate volumes for data that needs to persist beyond instance lifecycle
- Use AWS Config rules to automatically detect non-compliant configurations
- Document the purpose and data classification of each volume
