---
name: cis-aws-storage-6.2
description: "Ensure AWS Disaster Recovery Configuration"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, edr, disaster-recovery, network, architecture, vpc, replication]
cis_id: "6.2"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-6.1, cis-aws-storage-6.3, cis-aws-storage-6.4]
prerequisites: []
severity_boost: {}
---

# CIS 6.2: Ensure AWS Disaster Recovery Configuration (Manual)

## Profile Applicability

- **Level:** 2

## Description

It's important to understand how the network on EDR works. This isn't a simple service to configure, but it works with multiple work loads over the network. You can connect your on-premises or third-party cloud service to AWS EDR over the network.

### AWS Network Architecture for EDR:

1. **Local Network Connection:**
   - Connect an AWS Replication Agent to each of your resources in your local network inside the data center or cloud.

2. **AWS Cloud Architecture:**
   - Choose the AWS Region that you want to house your disaster recovery instances.
   - Create AWS API Endpoints for EC2, Disaster Recovery, and S3.
   - Upon creation of Disaster Recovery endpoints, two subnets will be created in your VPC:
     - **Staging Area Subnets:** Replication servers with EBS volumes attached to each disk on the servers.
     - **Recovery Subnets:** Recovery EC2 instances attached to EBS volumes.

3. **Network Connectivity:**
   - Connect local network over TCP port 443 to EDR and S3.
   - Connect local replication agent to AWS replication servers over TCP port 1500.
   - Connectivity out of staging area: Connect staging area on AWS to EDR over TCP port 443.
   - Allow connection to S3 over TCP 443.
   - Allow connectivity to EC2 over TCP 443 to connect to API Endpoint.

## Rationale

Understanding the network architecture is essential for proper EDR implementation. The network configuration ensures secure, reliable data replication between on-premises or third-party cloud environments and AWS, enabling effective disaster recovery capabilities.

## Impact

Proper network configuration requires careful planning of VPC architecture, subnet design, security group rules, and network connectivity. Organizations must ensure adequate bandwidth and network security controls are in place.

## Audit Procedure

This control focuses on understanding and documenting the network architecture. Verification should include:

- Reviewing VPC configuration for EDR endpoints
- Confirming staging and recovery subnets are properly configured
- Verifying security group rules allow required ports (TCP 443, TCP 1500)
- Ensuring network connectivity between on-premises and AWS
- Validating replication agent network access

## Expected Result

- VPC configured with proper EDR endpoints
- Staging Area Subnets created with replication servers
- Recovery Subnets created for EC2 instances
- Security groups allow TCP 443 (EDR, S3, EC2 API)
- Security groups allow TCP 1500 (replication traffic)
- Network connectivity tested and verified
- Bandwidth sufficient for replication requirements

## Remediation

### Via AWS Console

Configure the network architecture according to AWS EDR requirements:

1. Create or select VPC for EDR
2. Configure EDR API endpoints
3. Verify subnet creation (staging and recovery)
4. Configure security groups with required ports
5. Test network connectivity
6. Document network architecture

## Default Value

By default, no EDR network configuration exists. Organizations must manually configure the network architecture for EDR.

## References

- [AWS Disaster Recovery Documentation](https://aws.amazon.com/disaster-recovery/)
- [AWS Elastic Disaster Recovery Network Requirements](https://docs.aws.amazon.com/drs/latest/userguide/network-requirements.html)

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                  | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 11.4 Establish and Maintain an Isolated Instance of Recovery Data<br/>Establish and maintain an isolated instance of recovery data. Example implementations include, version controlling backup destinations through offline, cloud, or off-site systems or services.                    | ●    | ●    | ●    |
| v8               | 13.3 Deploy a Network Intrusion Detection Solution<br/>Deploy a network intrusion detection solution on enterprise assets, where appropriate. Example implementations include the use of a Network Intrusion Detection System (NIDS) or equivalent cloud service provider (CSP) service. |      | ●    | ●    |
| v7               | 10.4 Ensure Protection of Backups<br/>Ensure that backups are properly protected via physical security or encryption when they are stored, as well as when they are moved across the network. This includes remote backups and cloud services.                                           | ●    | ●    | ●    |
| v7               | 13.4 Only Allow Access to Authorized Cloud Storage or Email Providers<br/>Only allow access to authorized cloud storage or email providers.                                                                                                                                              |      | ●    | ●    |

## Profile

- Level 2
