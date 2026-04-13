---
name: cis-aws-storage-6.3
description: "Ensure functionality of Endpoint Detection and Response (EDR)"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, edr, endpoint-detection, security, threat-detection, malware]
cis_id: "6.3"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-6.1, cis-aws-storage-6.2, cis-aws-storage-6.4]
prerequisites: []
severity_boost: {}
---

# CIS 6.3: Ensure functionality of Endpoint Detection and Response (EDR) (Manual)

## Profile Applicability

- **Level:** 2

## Description

Establish and maintain an effective Endpoint Detection and Response (EDR) system to proactively monitor, detect, and respond to security threats on endpoints such as computers, mobile devices, and servers. This involves deploying EDR software that continuously collects data from endpoints, analyzes this data for signs of malicious activity, and provides real-time alerts and detailed incident reports. Regularly test and update the EDR system to ensure it can accurately identify and mitigate advanced threats, including zero-day exploits and sophisticated malware, ensuring comprehensive protection and swift response to potential security incidents.

## Rationale

Ensuring the functionality of Endpoint Detection and Response (EDR) systems is essential for early detection and swift response to security threats on endpoints. These systems continuously monitor and analyze endpoint data, providing real-time alerts and detailed incident reports to identify and mitigate potential threats. Regular testing and updates of the EDR system ensure it remains effective against advanced threats, maintaining comprehensive protection for the organization's assets.

## Impact

Implementing and maintaining EDR requires:
- Deployment of EDR software on all endpoints
- Continuous monitoring and analysis infrastructure
- Regular testing and updates
- Trained security personnel to respond to alerts
- Integration with incident response procedures

## Audit Procedure

### Via AWS Console

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
   - Remember what ports need to be opened on inbound / outbound traffic that was specified in previous steps.
   - You can choose how you want your data routed and if you want to throttle network traffic to reserve bandwidth.
   - To keep your data as secure as possible, it's recommended to get set up with a VPN or AWS direct connect, so your backups are not traveling over the public internet.
   - Point in time policy defines the snapshot retention time. Because Elastic Disaster Recovery service uses incremental backups, it's not necessary to keep old copies of backups.

9. **Launch the template:**
   - Now, you're ready to launch this template.

## Expected Result

- EDR environment properly prepared and configured
- Source servers have network access to EDR and S3 endpoints (TCP 443)
- Outbound TCP port 1500 configured from source to staging area
- Staging area subnet allows EDR, S3, EC2 access (TCP 443)
- Staging area allows inbound TCP 1500 for replication
- Replication settings template configured
- EBS encryption enabled
- Security groups properly configured
- Network routing configured (preferably VPN or Direct Connect)
- Point-in-time policy configured for snapshot retention

## Remediation

### Via AWS Console

Follow the audit procedure steps to configure EDR functionality:

1. Prepare the environment for EDR deployment
2. Configure source server network access
3. Configure staging area subnet
4. Access AWS Elastic Disaster Recovery Console
5. Configure replication settings template
6. Enable EBS encryption
7. Configure security groups with required ports
8. Set up secure network routing (VPN/Direct Connect recommended)
9. Configure point-in-time policy
10. Launch and test the configuration

## Default Value

By default, EDR is not configured. Organizations must manually set up all components including network access, security groups, replication settings, and encryption.

## References

- [AWS Elastic Disaster Recovery User Guide](https://docs.aws.amazon.com/drs/latest/userguide/)
- [AWS EDR Installation Requirements](https://docs.aws.amazon.com/mgn/latest/ug/installation-requirements.html)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 13.2 Deploy a Host-Based Intrusion Detection Solution<br/>Deploy a host-based intrusion detection solution on enterprise assets, where appropriate and/or supported. | | ● | ● |
| v8 | 13.3 Deploy a Network Intrusion Detection Solution<br/>Deploy a network intrusion detection solution on enterprise assets, where appropriate. Example implementations include the use of a Network Intrusion Detection System (NIDS) or equivalent cloud service provider (CSP) service. | | ● | ● |
| v7 | 8.6 Centralize Anti-malware Logging<br/>Send all malware detection events to enterprise anti-malware administration tools and event log servers for analysis and alerting. | | ● | ● |
| v7 | 12.6 Deploy Network-based IDS Sensor<br/>Deploy network-based Intrusion Detection Systems (IDS) sensors to look for unusual attack mechanisms and detect compromise of these systems at each of the organization's network boundaries. | | ● | ● |

## Profile

- Level 2
