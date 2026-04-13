---
name: cis-aws-storage-6.13
description: "Ensure working of EDR"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, edr, disaster-recovery, verification, testing, functionality]
cis_id: "6.13"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-6.1, cis-aws-storage-6.3, cis-aws-storage-6.4, cis-aws-storage-6.6, cis-aws-storage-6.12]
prerequisites: []
severity_boost: {}
---

# CIS 6.13: Ensure working of EDR (Manual)

## Profile Applicability

- **Level:** 2

## Description

This control ensures the complete functionality and proper configuration of AWS Elastic Disaster Recovery (EDR). It validates that all components of the EDR system are working correctly, from environment preparation through agent installation, replication, and recovery capabilities.

## Rationale

Verifying the working state of EDR is essential to ensure that disaster recovery capabilities are functional when needed. A comprehensive validation of all EDR components ensures that the organization can successfully recover from disasters, minimizing downtime and data loss. This holistic verification approach confirms that all prerequisites, configurations, and processes are properly aligned.

## Impact

Ensuring EDR functionality requires:
- Environment preparation and validation
- Source server configuration
- Staging area setup
- Replication agent installation
- Network connectivity verification
- Security group configuration
- Encryption implementation
- Point-in-time policy configuration

Benefits:
- Confidence in disaster recovery capability
- Early detection of configuration issues
- Validated recovery processes
- Verified data protection
- Compliance readiness

## Audit Procedure

### Via AWS Console

This control encompasses the complete EDR setup and verification process:

1. **Preparing the Environment for EDR:**
   - Before getting started with EDR, you must prepare the environment that you want to back up.

2. **Preparing the Source Server:**
   - Allow direct access to Elastic Disaster Recovery and Amazon S3 AWS service API endpoints through HTTPS protocol (TCP port 443).
   - Direct outbound TCP port 1500 from the source server to the staging area subnet, which contains the replication servers.

3. **Preparing the Staging Area Subnet:**
   - Allow Direct access to EDR, S3, and EC2 through HTTPS protocol (TCP port 443)
   - Direct inbound TCP port 1500 for replication traffic

4. **Accessing the AWS Elastic Disaster Recovery Console:**
   - Search for "AWS Elastic Disaster Recovery" in the AWS Console.
   - Select "Elastic Disaster Recovery"

5. **Configuring the Replication Settings Template:**
   - Select `Configure and Initializein` in the AWS Elastic Disaster Recovery screen.
   - You will be navigated to setup your replication settings template. This will create a staging area in a subnet of your choice and a replication server instance types.
   - The default replication server instance type will be a t3 micro EC2 instance. This is good for normal workloads with small I/O operations.

6. **Configure EBS encryption and volume types:**
   - This will depend on your workload requirements.

7. **Configure EBS volumes:**
   - To encrypt EBS volumes, leave the setting as "default." If you wish to make a custom encryption setting, you will need to create an AWS KMS key.

8. **Configure the security group:**
   - Remember what ports need to be opened on inbound / outbound traffic that was specified in previous steps:
   - You can choose how you want your data routed and if you want to throttle network traffic to reserve bandwidth.
   - To keep your data as secure as possible, it's recommended to get set up with a VPN or AWS direct connect, so your backups are not traveling over the public internet.
   - Point in time policy defines the snapshot retention time. Because Elastic Disaster Recovery service uses incremental backups, it's not necessary to keep old copies of backups.

9. **Launch the template:**
   - Now, you're ready to launch this template.

## Expected Result

**Environment Preparation:**
- Environment prepared for EDR deployment
- Backup requirements identified

**Source Server Configuration:**
- Direct access to EDR endpoints (TCP 443) configured
- Direct access to S3 endpoints (TCP 443) configured
- Outbound TCP port 1500 configured to staging area

**Staging Area Configuration:**
- Access to EDR, S3, EC2 via HTTPS (TCP 443) configured
- Inbound TCP port 1500 allowed for replication traffic

**EDR Console Access:**
- Successfully accessed AWS EDR console
- Service available and responsive

**Replication Settings:**
- Replication settings template configured
- Staging area created in appropriate subnet
- Replication server instance type selected (default: t3.micro)

**EBS Configuration:**
- EBS encryption enabled (default or custom KMS key)
- Volume types configured for workload requirements

**Security Group Configuration:**
- Security groups properly configured with required ports
- Network routing configured (VPN or Direct Connect recommended)
- Bandwidth throttling configured if needed

**Retention Policy:**
- Point-in-time policy configured
- Incremental backup strategy implemented

**Template Launch:**
- Template launched successfully
- EDR operational and ready for use

## Remediation

### Via AWS Console

Follow the complete EDR setup process:

1. **Prepare Environment:**
   - Identify systems requiring EDR protection
   - Document backup requirements
   - Plan network architecture

2. **Configure Source Server:**
   - Allow HTTPS access to EDR endpoints (TCP 443)
   - Allow HTTPS access to S3 endpoints (TCP 443)
   - Configure outbound TCP 1500 to staging area

3. **Configure Staging Area:**
   - Allow HTTPS to EDR, S3, EC2 (TCP 443)
   - Allow inbound TCP 1500 for replication

4. **Access EDR Console:**
   - Search for "AWS Elastic Disaster Recovery"
   - Open EDR console

5. **Configure Replication Template:**
   - Select "Configure and Initialize"
   - Choose staging area subnet
   - Select replication server instance type
   - Configure for workload I/O requirements

6. **Configure EBS:**
   - Enable EBS encryption (default recommended)
   - Create custom KMS key if needed
   - Select appropriate volume types

7. **Configure Security Groups:**
   - Configure required ports (TCP 443, TCP 1500)
   - Set up network routing
   - Implement VPN or Direct Connect for security
   - Configure bandwidth throttling if needed

8. **Configure Retention:**
   - Set point-in-time policy
   - Configure snapshot retention time
   - Leverage incremental backup strategy

9. **Launch and Verify:**
   - Launch the template
   - Verify all components are operational
   - Test replication
   - Validate recovery capabilities

## Default Value

By default, EDR is not configured or enabled. Organizations must complete the full configuration process to enable EDR functionality.

## References

- [AWS Elastic Disaster Recovery Documentation](https://aws.amazon.com/disaster-recovery/)
- [AWS EDR Getting Started Guide](https://docs.aws.amazon.com/drs/latest/userguide/getting-started.html)
- [AWS EDR Network Requirements](https://docs.aws.amazon.com/drs/latest/userguide/network-requirements.html)

## CIS Controls

This control represents a comprehensive validation of EDR functionality and supports multiple CIS Controls related to backup, recovery, and business continuity.

## Profile

- Level 2
