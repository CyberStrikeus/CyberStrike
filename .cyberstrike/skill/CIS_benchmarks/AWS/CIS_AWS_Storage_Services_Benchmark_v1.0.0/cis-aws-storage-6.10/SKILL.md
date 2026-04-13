---
name: cis-aws-storage-6.10
description: "Ensure execution of a Disaster Recovery Failover"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, edr, disaster-recovery, failover, recovery, business-continuity]
cis_id: "6.10"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-6.8, cis-aws-storage-6.9, cis-aws-storage-6.11]
prerequisites: []
severity_boost: {}
---

# CIS 6.10: Ensure execution of a Disaster Recovery Failover (Manual)

## Profile Applicability

- **Level:** 2

## Description

Execute a comprehensive disaster recovery failover to transition operations from the primary system to a backup system during disruptions. This process includes ensuring all critical data and applications are accurately replicated to the backup site for seamless operational continuity. Regularly test and document the failover process to identify and resolve any issues, maintaining readiness to minimize downtime and data loss during real disasters.

## Rationale

Executing a comprehensive disaster recovery failover is essential to ensure operational continuity during disruptions. Accurate replication of critical data and applications to the backup site guarantees that business operations can continue seamlessly. Regular testing and documentation of the failover process help identify and resolve potential issues, maintaining a state of readiness and minimizing downtime and data loss in actual disaster scenarios.

## Impact

Failover execution requires:
- Comprehensive planning and preparation
- Testing in non-production environments first
- Documented procedures
- Trained personnel
- Potential brief service interruption
- Post-failover validation

Benefits:
- Validates failover capability
- Ensures business continuity
- Minimizes downtime
- Protects against data loss
- Builds confidence in DR capabilities
- Identifies issues before real disasters

## Audit Procedure

### Via AWS Console

Follow the steps where we learned how to conduct a recovery drill with the below modifications:

1. **Select Server for Failover:**
   - Choose the server that you want to recover and failover.
   - On the initiate recovery job menu, choose "initiate recovery."

2. **Choose Recovery Point:**
   - Choose a point in time to recover from backup.

3. **Initiate Recovery Job:**
   - Choose initiate recovery to create a recovery job.

**Note:** You can use the job details to monitor the progress and status of the recovery job.

4. **Verify Completion:**
   - After the recovery job has completed, the last recovery result of your source server will report "successful."
   - The EC2 instance ID of the launched recovery instance will also be listed in the source server overview.

5. **Test Recovery Instance:**
   - You can test if the recovery instance is functioning by testing the EC2 instance that is in the source server overview.

## Expected Result

- Recovery job initiated successfully
- Server selected for failover
- Recovery point chosen appropriately
- Job details available for monitoring
- Recovery job completes successfully
- Source server reports "successful" recovery status
- EC2 instance ID listed in source server overview
- Recovery instance accessible and functional
- All critical data replicated correctly
- Applications running on recovery instance
- Minimal downtime experienced
- Process documented

## Remediation

### Via AWS Console

1. **Prepare for Failover:**
   - Identify the server to recover and failover
   - Verify backup status
   - Review recovery procedures

2. **Initiate Failover:**
   - Navigate to recovery job menu
   - Select server for failover
   - Choose "initiate recovery" (not "initiate drill")
   - Select appropriate point-in-time backup
   - Confirm and initiate recovery job

3. **Monitor Progress:**
   - Use job details to monitor progress
   - Track recovery job status
   - Watch for any errors or issues

4. **Verify Completion:**
   - Confirm recovery result shows "successful"
   - Verify EC2 instance ID appears in source server overview
   - Check instance launch status

5. **Test Recovery Instance:**
   - Access the recovered EC2 instance
   - Verify data integrity
   - Test application functionality
   - Confirm all services are operational

6. **Document Results:**
   - Record recovery time
   - Document any issues encountered
   - Note lessons learned
   - Update procedures if needed

## Default Value

Implement a disaster recovery failover.

By default, no failover procedures are configured or automated. Organizations must manually plan, test, and execute failover operations.

## References

- [AWS Elastic Disaster Recovery - Failback Preparing - Failover](https://docs.aws.amazon.com/drs/latest/userguide/failback-preparing-failover.html)
- [AWS DR Failover Best Practices](https://docs.aws.amazon.com/drs/latest/userguide/failover.html)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 11.4 Establish and Maintain an Isolated Instance of Recovery Data<br/>Establish and maintain an isolated instance of recovery data. Example implementations include, version controlling backup destinations through offline, cloud, or off-site systems or services. | ● | ● | ● |
| v8 | 11.5 Test Data Recovery<br/>Test backup recovery quarterly, or more frequently, for a sampling of in-scope enterprise assets. | | ● | ● |
| v7 | 10.4 Ensure Protection of Backups<br/>Ensure that backups are properly protected via physical security or encryption when they are stored, as well as when they are moved across the network. This includes remote backups and cloud services. | ● | ● | ● |
| v7 | 10.5 Ensure Backups Have At least One Non-Continuously Addressable Destination<br/>Ensure that all backups have at least one backup destination that is not continuously addressable through operating system calls. | ● | ● | ● |

## Profile

- Level 2
