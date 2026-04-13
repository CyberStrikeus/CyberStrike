---
name: cis-aws-storage-6.9
description: "Ensure Continuous Disaster Recovery Operations"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, edr, disaster-recovery, continuous-operations, monitoring, backup, replication]
cis_id: "6.9"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-6.1, cis-aws-storage-6.8, cis-aws-storage-6.10, cis-aws-storage-6.12]
prerequisites: []
severity_boost: {}
---

# CIS 6.9: Ensure Continuous Disaster Recovery Operations (Manual)

## Profile Applicability

- **Level:** 2

## Description

Maintain ongoing disaster recovery operations to ensure that systems and data can be swiftly restored in the event of a disaster. This involves regularly updating and testing recovery plans, monitoring replication processes, and verifying the integrity and accessibility of backups. Continuously evaluate and improve disaster recovery strategies to adapt to evolving threats and organizational changes, ensuring resilience and minimal downtime during incidents.

## Rationale

Maintaining continuous disaster recovery operations is essential for ensuring that systems and data can be quickly and effectively restored following a disruption. Regular updates and tests of recovery plans, along with constant monitoring of replication processes, help verify the integrity and availability of backups. This proactive approach allows organizations to adapt to evolving threats and changes, ensuring resilience and minimizing downtime during incidents, which ultimately protects business continuity and reduces potential losses.

## Impact

Continuous disaster recovery operations require:
- Ongoing monitoring and maintenance
- Regular plan updates
- Periodic testing
- Resource allocation for DR activities
- Staff training and awareness
- Documentation maintenance
- Compliance verification

Benefits:
- Ensures rapid recovery capability
- Minimizes downtime
- Protects business continuity
- Reduces potential data loss
- Maintains compliance
- Builds organizational confidence

## Audit Procedure

### Via AWS Console

1. **Review Disaster Recovery Plan:**
   - Verify that a comprehensive disaster recovery (DR) plan exists and is regularly updated.
   - Ensure the DR plan includes detailed procedures for data backup, system recovery, and failover processes.
   - Check for documentation of roles and responsibilities during a disaster event.

2. **Check Backup and Replication Settings:**
   - Confirm that AWS Backup is configured correctly for all critical systems and data.
   - Review the settings for Amazon RDS, EBS snapshots, S3 versioning, and other AWS services to ensure backups are automated and scheduled appropriately.
   - Ensure that replication settings are configured to replicate data across multiple AWS regions for added redundancy.

3. **Test Recovery Procedures:**
   - Verify that regular recovery drills are conducted to test the DR plan's effectiveness.
   - Check the logs and reports from these drills to ensure that any issues identified are addressed promptly.
   - Ensure that the most recent recovery drill results are documented and reviewed by relevant stakeholders.

4. **Monitor and Log Review:**
   - Ensure CloudWatch logs and alarms are set up to monitor backup and replication processes.
   - Review CloudTrail logs to verify that DR-related actions are being logged and monitored.
   - Check for alerts and notifications related to backup failures, replication issues, or any anomalies in the DR processes.

5. **Evaluate Recovery Time Objectives (RTO) and Recovery Point Objectives (RPO):**
   - Verify that the DR plan specifies RTO and RPO for all critical systems and data.
   - Ensure that actual recovery times and points from recent drills meet or exceed the defined objectives.

6. **Review Access Controls:**
   - Check IAM policies to ensure that only authorized personnel have access to manage and initiate disaster recovery operations.
   - Verify that multi-factor authentication (MFA) is enabled for accounts with access to DR resources.

7. **Assess Security and Compliance:**
   - Ensure that data encryption is enabled for all backups and replicated data.
   - Verify compliance with industry standards and regulations (e.g., GDPR, HIPAA) concerning data protection and disaster recovery.

8. **Continuous Improvement:**
   - Review post-mortem reports from actual incidents and recovery drills to identify areas for improvement.
   - Ensure that feedback loops are in place for continuous enhancement of the DR plan and procedures.
   - Confirm that lessons learned from incidents and drills are incorporated into the DR plan.

9. **Regular Updates and Communication:**
   - Ensure the DR plan is reviewed and updated at least annually or whenever significant changes occur in the IT environment.
   - Verify that all relevant personnel are trained on the DR procedures and aware of their roles.
   - Check that regular communication channels are established for DR updates and training sessions.

## Expected Result

- Comprehensive DR plan exists and is regularly updated
- DR plan includes detailed backup, recovery, and failover procedures
- Roles and responsibilities documented
- AWS Backup configured correctly for all critical systems
- Automated backup schedules in place (RDS, EBS, S3, etc.)
- Replication configured across multiple AWS regions
- Regular recovery drills conducted
- Drill results documented and reviewed
- CloudWatch monitoring configured for backups and replication
- CloudTrail logging enabled for DR actions
- Alerts configured for failures and anomalies
- RTO and RPO defined for all critical systems
- Actual recovery times meet objectives
- IAM policies restrict DR access to authorized personnel only
- MFA enabled for DR resource access
- Data encryption enabled for all backups and replicated data
- Compliance requirements met (GDPR, HIPAA, etc.)
- Post-mortem reviews conducted after incidents and drills
- Feedback incorporated into DR plan
- DR plan reviewed and updated at least annually
- Personnel trained on DR procedures
- Regular communication channels established

## Remediation

### Via AWS Console

Follow the audit procedure steps to implement continuous disaster recovery operations:

1. **Update/Create DR Plan:**
   - Develop comprehensive DR plan with detailed procedures
   - Document roles and responsibilities
   - Define RTO and RPO for all critical systems

2. **Configure Backup and Replication:**
   - Set up AWS Backup for all critical systems
   - Configure automated schedules for RDS, EBS, S3
   - Enable cross-region replication

3. **Implement Monitoring:**
   - Configure CloudWatch logs and alarms
   - Enable CloudTrail logging for DR actions
   - Set up alerts for failures and anomalies

4. **Establish Testing Schedule:**
   - Plan regular recovery drills
   - Document drill results
   - Review and address identified issues

5. **Configure Access Controls:**
   - Review and update IAM policies
   - Enable MFA for DR resource access
   - Implement least-privilege access

6. **Enable Security Controls:**
   - Enable encryption for all backups
   - Configure encryption for replicated data
   - Verify compliance requirements

7. **Establish Continuous Improvement:**
   - Conduct post-mortem reviews
   - Implement feedback loops
   - Update DR plan based on lessons learned

8. **Maintain Communication:**
   - Schedule annual DR plan reviews
   - Conduct personnel training
   - Establish regular communication channels

## Default Value

By default, continuous disaster recovery operations are not configured. Organizations must manually establish all components including plans, backups, monitoring, testing schedules, and improvement processes.

## References

- [AWS Disaster Recovery Workloads on AWS](https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-options-in-the-cloud.html)
- [AWS Well-Architected Framework - Reliability Pillar](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 11.1 Establish and Maintain a Data Recovery Process<br/>Establish and maintain a data recovery process. In the process, address the scope of data recovery activities, recovery prioritization, and the security of backup data. Review and update documentation annually, or when significant enterprise changes occur that could impact this Safeguard. | ● | ● | ● |
| v8 | 11.5 Test Data Recovery<br/>Test backup recovery quarterly, or more frequently, for a sampling of in-scope enterprise assets. | | ● | ● |
| v7 | 10.2 Perform Complete System Backups<br/>Ensure that each of the organization's key systems are backed up as a complete system, through processes such as imaging, to enable the quick recovery of an entire system. | ● | ● | ● |
| v7 | 19.7 Conduct Periodic Incident Scenario Sessions for Personnel<br/>Plan and conduct routine incident response exercises and scenarios for the workforce involved in the incident response to maintain awareness and comfort in responding to real world threats. Exercises should test communication channels, decision making, and incident responders technical capabilities using tools and data available to them. | | ● | ● |

## Profile

- Level 2
