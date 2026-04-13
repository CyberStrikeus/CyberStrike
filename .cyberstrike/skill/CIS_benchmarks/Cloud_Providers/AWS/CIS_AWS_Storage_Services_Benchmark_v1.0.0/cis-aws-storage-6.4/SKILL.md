---
name: cis-aws-storage-6.4
description: "Ensure configuration of replication settings"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, edr, replication, data-duplication, bandwidth, rto, rpo]
cis_id: "6.4"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-6.1, cis-aws-storage-6.2, cis-aws-storage-6.3, cis-aws-storage-6.6]
prerequisites: []
severity_boost: {}
---

# CIS 6.4: Ensure configuration of replication settings (Manual)

## Profile Applicability

- **Level:** 2

## Description

Set up and maintain the replication settings to ensure accurate and efficient data duplication across systems. Proper configuration includes specifying source and target locations, defining replication schedules, and setting bandwidth limits to optimize performance. Regularly review and update these settings to accommodate changes in data volume and network conditions, ensuring data integrity and availability during replication processes.

## Rationale

Proper configuration of replication settings is essential to ensure data consistency and availability across systems. Accurate replication schedules and bandwidth management optimize performance and prevent network congestion. Regular reviews and updates of these settings help adapt to changes in data volume and network conditions, maintaining efficient and reliable data replication processes.

## Impact

Replication configuration affects:

- Data consistency across regions
- Network bandwidth utilization
- Recovery Time Objective (RTO) and Recovery Point Objective (RPO)
- Operational costs
- System performance

## Audit Procedure

### Via AWS Console

1. **Access Replication Settings:**
   - Select "Configure and Initialize" in the AWS Elastic Disaster Recovery screen.
   - You will be navigated to setup your replication settings template.
   - This will create a staging area in a subnet of your choice and a replication server instance types.
   - The default replication server instance type will be a t3 micro EC2 instance. This is good for normal workloads with small I/O operations.

2. **Review EBS Configuration:**
   - Configure EBS encryption and volume types. This will depend on your workload requirements.
   - To encrypt EBS volumes, leave the setting as "default." If you wish to make a custom encryption setting, you will need to create an AWS KMS key.

3. **Review Security Group Configuration:**
   - Configure the security group to your specific needs.
   - Remember what ports need to be opened on inbound / outbound traffic that was specified in previous steps.
   - You can choose how you want your data routed and if you want to throttle network traffic to reserve bandwidth.
   - To keep your data as secure as possible, it's recommended to get set up with a VPN or AWS direct connect, so your backups are not traveling over the public internet.
   - Point in time policy defines the snapshot retention time. Because Elastic Disaster Recovery service uses incremental backups, it's not necessary to keep old copies of backups.

4. **Launch Template:**
   - Now, you're ready to launch this template.

## Expected Result

- Replication settings template properly configured
- Staging area created in appropriate subnet
- Replication server instance type selected (default: t3.micro for small I/O)
- EBS encryption configured (default or custom KMS key)
- EBS volume types match workload requirements
- Security groups configured with correct ports:
  - Inbound TCP 1500 for replication traffic
  - Outbound TCP 443 for EDR, S3, EC2 API access
- Network routing configured appropriately
- Bandwidth throttling configured if needed
- VPN or AWS Direct Connect recommended for secure transit
- Point-in-time policy configured for snapshot retention
- Incremental backup strategy implemented

## Remediation

### Via AWS Console

1. **Configure Replication Template:**
   - Navigate to AWS Elastic Disaster Recovery service
   - Select "Configure and Initialize"
   - Choose staging area subnet
   - Select appropriate replication server instance type

2. **Configure EBS Settings:**
   - Configure EBS encryption (leave as "default" or create custom KMS key)
   - Select appropriate volume types for workload requirements

3. **Configure Security Groups:**
   - Configure security group rules:
     - Allow inbound TCP 1500 for replication
     - Allow outbound TCP 443 for EDR, S3, EC2
   - Configure network routing
   - Set bandwidth throttling if needed
   - Implement VPN or Direct Connect for secure data transit

4. **Configure Retention Policy:**
   - Set point-in-time policy for snapshot retention
   - Configure incremental backup settings

5. **Launch Configuration:**
   - Review all settings
   - Launch the replication template
   - Verify configuration is active

## Default Value

By default, no replication settings are configured. Organizations must manually configure all replication parameters including staging area, instance types, encryption, security groups, and retention policies.

## References

- [AWS Elastic Disaster Recovery Replication Settings](https://docs.aws.amazon.com/drs/latest/userguide/replication-settings.html)
- [AWS EDR Configuration Best Practices](https://docs.aws.amazon.com/drs/latest/userguide/best-practices.html)

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 11.2 Perform Automated Backups<br/>Perform automated backups of in-scope enterprise assets. Run backups weekly, or more frequently, based on the sensitivity of the data.                                                                                             | ●    | ●    | ●    |
| v8               | 11.4 Establish and Maintain an Isolated Instance of Recovery Data<br/>Establish and maintain an isolated instance of recovery data. Example implementations include, version controlling backup destinations through offline, cloud, or off-site systems or services. | ●    | ●    | ●    |
| v7               | 10.4 Ensure Protection of Backups<br/>Ensure that backups are properly protected via physical security or encryption when they are stored, as well as when they are moved across the network. This includes remote backups and cloud services.                        | ●    | ●    | ●    |
| v7               | 10.5 Ensure Backups Have At least One Non-Continuously Addressable Destination<br/>Ensure that all backups have at least one backup destination that is not continuously addressable through operating system calls.                                                  | ●    | ●    | ●    |

## Profile

- Level 2
