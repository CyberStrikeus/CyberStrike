---
name: cis-aws-storage-6.8
description: "Ensure execution of a recovery drill"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, edr, disaster-recovery, drill, testing, recovery-testing, rto, rpo]
cis_id: "6.8"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-6.1, cis-aws-storage-6.7, cis-aws-storage-6.9, cis-aws-storage-6.10]
prerequisites: []
severity_boost: {}
---

# CIS 6.8: Ensure execution of a recovery drill (Manual)

## Profile Applicability

- **Level:** 2

## Description

To ensure your organization is prepared for a disaster, it's crucial to verify that your disaster recovery services function as expected. Your IT team should conduct regular recovery drills on your AWS Elastic Recovery Instance to confirm everything operates smoothly and according to plan.

## Rationale

Regular recovery drills are essential to verify the functionality of your disaster recovery services and ensure your organization is well-prepared for any disruptions. By conducting these drills on your AWS Elastic Recovery Instance, you can identify and address potential issues before they impact operations. This proactive approach enhances the reliability and effectiveness of your disaster recovery plan, providing confidence that your systems can recover swiftly and efficiently in the event of a disaster.

## Impact

Recovery drills require:

- Planning and scheduling
- Non-production environment for testing
- Time and resources for execution
- Documentation of results
- Potential discovery of configuration issues
- Updates to recovery procedures based on findings

Benefits:

- Validates disaster recovery plan effectiveness
- Identifies potential issues before real disasters
- Ensures team familiarity with recovery procedures
- Confirms RTO and RPO objectives are achievable
- Provides confidence in recovery capabilities

## Audit Procedure

### Via AWS Console

**Steps to perform a recovery drill:**

1. **Navigate to Source Servers:**
   - Navigate to source servers tab in AWS Elastic Disaster Recovery Dashboard.

2. **Verify Server Status:**
   - Make sure that all servers you launch show as "Ready" under "status," report as "healthy" in the data replication status column, and that pending actions show as "initiate drill".

3. **Initiate Drill:**
   - Select "initiate drill" under the orange dropdown menu.
   - Make sure that you don't initiate a real recovery job.

4. **Choose Recovery Point:**
   - Choose a recovery point. Normally, it makes sense to choose the most recent recovery point, but you can also choose a recovery point from earlier.

5. **Select Initiate Drill:**
   - Select the orange "initiate drill" button to initiate the recovery drill.

6. **Clean Up:**
   - To complete the recovery drill, clean up your resources by deleting the recovery instance by selecting actions and "terminate recovery instances".

## Expected Result

- All source servers show status "Ready"
- Data replication status reports "healthy"
- Pending actions show "initiate drill"
- Recovery drill initiated successfully
- Recovery point selected (most recent or specific point)
- Drill completes without errors
- Recovery instance launches successfully
- Recovery time measured and documented
- Recovery time meets RTO objectives
- Recovery point meets RPO objectives
- Issues identified and documented
- Recovery instances terminated after drill
- Resources cleaned up properly

## Remediation

### Via AWS Console

1. **Prepare for Drill:**
   - Ensure all source servers are in "Ready" status
   - Verify data replication status is "healthy"
   - Confirm pending actions show "initiate drill"

2. **Execute Drill:**
   - Navigate to source servers tab in EDR Dashboard
   - Select "initiate drill" from orange dropdown menu
   - **IMPORTANT:** Do not initiate a real recovery job
   - Choose appropriate recovery point (typically most recent)
   - Click orange "initiate drill" button

3. **Monitor Drill:**
   - Observe recovery instance launch
   - Measure and document recovery time
   - Test recovered instance functionality
   - Verify data integrity

4. **Document Results:**
   - Record recovery time
   - Compare against RTO and RPO objectives
   - Document any issues encountered
   - Note lessons learned

5. **Clean Up:**
   - Select actions menu
   - Choose "terminate recovery instances"
   - Confirm termination
   - Verify resources are cleaned up

6. **Review and Update:**
   - Review drill results with team
   - Update recovery procedures as needed
   - Schedule next drill

## Default Value

By default, no recovery drills are scheduled or configured. Organizations must manually plan and execute recovery drills.

## References

- [AWS Elastic Disaster Recovery - Failback Preparing](https://docs.aws.amazon.com/drs/latest/userguide/failback-preparing.html)
- [AWS DR Testing Best Practices](https://docs.aws.amazon.com/drs/latest/userguide/drill-recovery.html)

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                                | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 11.5 Test Data Recovery<br/>Test backup recovery quarterly, or more frequently, for a sampling of in-scope enterprise assets.                                                                                                                                                                                                                                                                                          |      | ●    | ●    |
| v8               | 17.7 Conduct Routine Incident Response Exercises<br/>Plan and conduct routine incident response exercises and scenarios for key personnel involved in the incident response process to prepare for responding to real-world incidents. Exercises need to test communication channels, decision making, and workflows. Conduct testing on an annual basis, at a minimum.                                                |      | ●    | ●    |
| v7               | 10.3 Test Data on Backup Media<br/>Test data integrity on backup media on a regular basis by performing a data restoration process to ensure that the backup is properly working.                                                                                                                                                                                                                                      |      | ●    | ●    |
| v7               | 19.7 Conduct Periodic Incident Scenario Sessions for Personnel<br/>Plan and conduct routine incident response exercises and scenarios for the workforce involved in the incident response to maintain awareness and comfort in responding to real world threats. Exercises should test communication channels, decision making, and incident responders technical capabilities using tools and data available to them. |      | ●    | ●    |

## Profile

- Level 2
