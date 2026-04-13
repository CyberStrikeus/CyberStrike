---
name: cis-aws-storage-6.1
description: "Ensure Elastic Disaster Recovery is Configured"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, edr, disaster-recovery, backup, resilience, business-continuity]
cis_id: "6.1"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-6.2, cis-aws-storage-6.3, cis-aws-storage-6.4, cis-aws-storage-6.8, cis-aws-storage-6.9]
prerequisites: []
severity_boost: {}
---

# CIS 6.1: Ensure Elastic Disaster Recovery is Configured (Manual)

## Profile Applicability

- **Level:** 2

## Description

AWS Elastic Disaster Recovery is a service that enables you to create and maintain backups of your workloads on AWS, specifically your servers. This service is crucial for ensuring high resilience for your AWS workloads. It operates by establishing and maintaining backups in selected AWS regions, guaranteeing that your data is safe, durable, and highly available in the event of issues in the primary availability zone or region where your AWS server is located.

AWS Elastic Disaster Recovery is essential to providing high resilience to your AWS workloads. It works by establishing and maintaining backups in AWS regions of your choosing, to ensure that your backups are safe, durable, and highly available if something goes wrong in the availability zone or region that your AWS server resides.

## Rationale

AWS Elastic Disaster Recovery is crucial for establishing high resiliency in the cloud, synonymous with effective disaster recovery. High resiliency measures your organization's ability to respond to and recover from disasters impacting IT infrastructure. Achieving high resiliency minimizes downtime and long-term costs associated with outages, while low resiliency can result in prolonged downtime, potential data loss, and even permanent infrastructure damage.

## Impact

Implementing AWS Elastic Disaster Recovery requires planning, configuration, and ongoing maintenance. Organizations must allocate resources for setup, testing, and monitoring to ensure the disaster recovery solution remains effective.

## Audit Procedure

### Via AWS Console

1. **Review Disaster Recovery Plans:**
   - Log in to the AWS Management Console.
   - Navigate to the AWS Elastic Disaster Recovery service.
   - Locate and open the disaster recovery plans.
   - Verify that the plans are current and comprehensive, covering all critical workloads.
   - Ensure that the plans specify clear recovery time objectives (RTO) and recovery point objectives (RPO).

2. **Check Backup Configurations:**
   - In the AWS Elastic Disaster Recovery dashboard, review the list of protected servers and workloads.
   - Confirm that backups are enabled for all critical servers and workloads.
   - Verify the backup schedule and frequency to ensure they meet organizational requirements.
   - Check that backups are being stored in the correct AWS regions as specified in the disaster recovery plan.

3. **Test Recovery Procedures:**
   - Identify a non-production environment to conduct recovery drills.
   - Initiate a simulated disaster scenario to test the recovery procedures.
   - Execute the recovery process for each critical workload.
   - Measure and document the time taken to recover each workload.
   - Compare the measured recovery times against the RTO and RPO.
   - Identify and document any issues or delays encountered during the recovery process.

4. **Monitor Backup Integrity:**
   - Open the AWS CloudWatch console.
   - Set up CloudWatch Alarms to monitor the status of backups.
   - Configure alerts for any failed or incomplete backups.
   - Regularly review the CloudWatch logs to verify that backups are successfully completed and stored.

5. **Evaluate Backup Storage and Security:**
   - Access the AWS S3 or Glacier console, depending on where backups are stored.
   - Verify that all backup data is encrypted in transit and at rest.
   - Check the storage settings to confirm that data is being stored in secure, durable storage solutions.
   - Review the access control policies to ensure that only authorized personnel have access to backup data.

6. **Ensure Compliance with Policies and Regulations:**
   - Review organizational and regulatory compliance requirements relevant to disaster recovery.
   - Ensure that the disaster recovery practices and configurations comply with these requirements.
   - Document the compliance efforts, including any specific steps taken to meet industry standards and regulations.
   - Prepare reports or evidence of compliance for any upcoming audits or assessments.

## Expected Result

- Comprehensive disaster recovery plans exist covering all critical workloads
- Clear RTO and RPO objectives are documented
- Backups are enabled for all critical systems
- Backup schedules meet organizational requirements
- Backups are stored in appropriate AWS regions
- Recovery procedures have been tested successfully
- CloudWatch monitoring is configured for backup status
- All backup data is encrypted in transit and at rest
- Access controls limit backup access to authorized personnel only
- Disaster recovery practices comply with relevant regulations

## Remediation

### Via AWS Console

1. **Update Disaster Recovery Plans:**
   - Log in to the AWS Management Console.
   - Navigate to the AWS Elastic Disaster Recovery service.
   - Locate and review the current disaster recovery plans.
   - Update the plans to ensure they are comprehensive and cover all critical workloads.
   - Ensure that the plans specify clear recovery time objectives (RTO) and recovery point objectives (RPO).
   - Save and document the updated plans.

2. **Correct Backup Configurations:**
   - In the AWS Elastic Disaster Recovery dashboard, review the list of protected servers and workloads.
   - Enable backups for any critical servers and workloads that are not currently being backed up.
   - Adjust the backup schedule and frequency to meet organizational requirements.
   - Ensure backups are stored in the correct AWS regions as specified in the disaster recovery plan.

3. **Conduct Recovery Procedure Drills:**
   - Identify a non-production environment to conduct recovery drills.
   - Simulate a disaster scenario to test the recovery procedures.
   - Execute the recovery process for each critical workload.
   - Measure and document the time taken to recover each workload.
   - Compare the measured recovery times against the RTO and RPO.
   - Identify and address any issues or delays encountered during the recovery process.
   - Update the recovery procedures based on the findings from the drill.

4. **Ensure Backup Integrity:**
   - Open the AWS CloudWatch console.
   - Set up CloudWatch Alarms to monitor the status of backups.
   - Configure alerts for any failed or incomplete backups.
   - Regularly review CloudWatch logs to verify that backups are successfully completed and stored.
   - Resolve any issues identified in the logs, such as incomplete or failed backups.

5. **Enhance Backup Storage and Security:**
   - Access the AWS S3 or Glacier console, depending on where backups are stored.
   - Ensure all backup data is encrypted in transit and at rest.
   - Adjust storage settings to confirm that data is being stored in secure, durable storage solutions.
   - Review and update access control policies to ensure only authorized personnel can access backup data.
   - Implement any additional security measures necessary to protect the backup data.

6. **Ensure Compliance with Policies and Regulations:**
   - Review organizational and regulatory compliance requirements relevant to disaster recovery.
   - Adjust disaster recovery practices and configurations to ensure compliance with these requirements.
   - Document the compliance efforts, including specific steps taken to meet industry standards and regulations.
   - Prepare and maintain reports or evidence of compliance for any upcoming audits or assessments.

## Default Value

By default, AWS Elastic Disaster Recovery is not configured. Organizations must manually set up and configure the service to establish disaster recovery capabilities.

## References

- [AWS Elastic Disaster Recovery Documentation](https://aws.amazon.com/disaster-recovery/)
- [AWS Well-Architected Framework - Reliability Pillar](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html)

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 11.2 Perform Automated Backups<br/>Perform automated backups of in-scope enterprise assets. Run backups weekly, or more frequently, based on the sensitivity of the data.                                            | ●    | ●    | ●    |
| v7               | 10.2 Perform Complete System Backups<br/>Ensure that each of the organization's key systems are backed up as a complete system, through processes such as imaging, to enable the quick recovery of an entire system. | ●    | ●    | ●    |

## Profile

- Level 2
