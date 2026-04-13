---
name: cis-aws-storage-6.11
description: "Ensure execution of a failback"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, edr, disaster-recovery, failback, recovery, restoration]
cis_id: "6.11"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-6.10, cis-aws-storage-6.9]
prerequisites: []
severity_boost: {}
---

# CIS 6.11: Ensure execution of a failback (Manual)

## Profile Applicability

- **Level:** 2

## Description

This method involves transitioning operations back from the backup or recovery system to the primary system after the resolution of a disruption or disaster. You can execute a failback either to the original server, ensuring continuity and restoring the previous state, or to a new server, which might be necessary if the original server is compromised or no longer functional. The failback process ensures that all updated data and configurations are transferred back, maintaining the integrity and functionality of the primary system.

## Rationale

A failback is crucial for restoring normal operations after a disaster recovery scenario. Transitioning operations back to the primary system ensures continuity and leverages the original environment's configurations and settings. This process can be directed either to the original server, maintaining the existing infrastructure, or to a new server if the original is compromised. Ensuring all data and configurations are accurately transferred back preserves system integrity and functionality, reducing downtime and allowing the organization to resume normal operations efficiently.

## Impact

Failback operations require:
- Completion of disaster resolution
- Verification that primary environment is ready
- Failback client ISO installation
- Data synchronization between recovery and primary
- Potential brief service interruption
- Post-failback validation

Prerequisites:
- Volumes on server being failed back to must be same size or larger than recovery instance
- Failback client must have proper IAM permissions
- Network connectivity (TCP 1500 inbound, TCP 443 outbound)
- Public IP added to recovery instance

## Audit Procedure

### Via AWS Console

**Performing the failback:**

1. **Download Failback Client ISO:**
   - Download the failback client ISO

2. **Attach ISO and Boot:**
   - Attach the ISO to your original server and boot up the server.
   - The failback client will prompt for the IAM access key and secret key generated when making the user with the permission to access the failback.
   - It will also ask for the recovery instance. Remember: regions are case sensitive. If you're in US east 1, type "us-east-1."

3. **Select Target Server:**
   - If you are failing back to the original server, the failback client will automatically detect the recovery instance and map the data volumes for replication.
   - If you are failing back to a new server, you may need to manually specify from a list of available recovery instances and map the data volumes.

4. **Monitor Replication:**
   - Return to the elastic disaster recovery console and recovery instances to see the current state of replication.
   - Failing back to the original server will show "rescan" in the console, while failing back to a new instance will perform an "initial sync."

5. **Complete Data Replication:**
   - After the data replication is completed, you will be able to perform the failback.
   - Check the state of the recovery instance to ensure that it's ready to complete a failback.
   - Select your recovery instance, then choose failback for the chosen recovery instance(s).

6. **Execute Failback:**
   - Choose failback again the complete a failback for the chosen recovery instance(s).
   - During the failback process, the failback client will prepare your source server for normal operation.
   - After it has completed successfully, the failback client will return "failback completed successfully" in the console.

7. **Finalize:**
   - Reboot the server and return to normal operations.

8. **Clean Up:**
   - Clean up failback job; terminate recovery job by following the steps outlined above when we ran a drill.

## Expected Result

- Failback client ISO downloaded successfully
- ISO attached to original/new server
- Server boots with failback client
- IAM credentials provided and authenticated
- Region entered correctly (case-sensitive)
- Recovery instance detected (automatic or manual)
- Data volumes mapped correctly
- Replication initiated and monitored
- Console shows appropriate status ("rescan" or "initial sync")
- Data replication completes successfully
- Recovery instance ready for failback
- Failback initiated successfully
- Failback completes with success message
- Server rebooted successfully
- Normal operations restored
- Failback job cleaned up
- Recovery instances terminated

## Remediation

### Via AWS Console

1. **Prepare Failback Environment:**
   - Verify original/target server meets prerequisites:
     - Volumes same size or larger than recovery instance
     - Network allows TCP 1500 inbound, TCP 443 outbound
     - Public IP available if needed
   - Ensure IAM credentials are accessible

2. **Install Failback Client:**
   - Download failback client ISO
   - Attach ISO to target server
   - Boot server from ISO

3. **Configure Failback:**
   - Enter IAM access key and secret key
   - Enter region (case-sensitive, e.g., "us-east-1")
   - For original server: automatic detection
   - For new server: manually select recovery instance and map volumes

4. **Monitor Replication:**
   - Access elastic disaster recovery console
   - Navigate to recovery instances
   - Monitor replication status:
     - "rescan" for original server
     - "initial sync" for new server
   - Wait for replication to complete

5. **Execute Failback:**
   - Verify recovery instance is ready
   - Select recovery instance
   - Choose "failback" option
   - Confirm failback action
   - Monitor failback progress
   - Wait for "failback completed successfully" message

6. **Finalize and Clean Up:**
   - Reboot the server
   - Verify normal operations
   - Test system functionality
   - Clean up failback job
   - Terminate recovery instances
   - Document the process

## Default Value

By default, no failback procedures are configured. Organizations must manually execute failback operations when needed.

## References

- [AWS Elastic Disaster Recovery - Failback Performing Main](https://docs.aws.amazon.com/drs/latest/userguide/failback-performing-main.html)
- [AWS EDR Failback Best Practices](https://docs.aws.amazon.com/drs/latest/userguide/failback.html)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 11.1 Establish and Maintain a Data Recovery Process<br/>Establish and maintain a data recovery process. In the process, address the scope of data recovery activities, recovery prioritization, and the security of backup data. Review and update documentation annually, or when significant enterprise changes occur that could impact this Safeguard. | ● | ● | ● |
| v8 | 11.5 Test Data Recovery<br/>Test backup recovery quarterly, or more frequently, for a sampling of in-scope enterprise assets. | | ● | ● |
| v7 | 10.2 Perform Complete System Backups<br/>Ensure that each of the organization's key systems are backed up as a complete system, through processes such as imaging, to enable the quick recovery of an entire system. | ● | ● | ● |
| v7 | 10.3 Test Data on Backup Media<br/>Test data integrity on backup media on a regular basis by performing a data restoration process to ensure that the backup is properly working. | | ● | ● |

## Profile

- Level 2
