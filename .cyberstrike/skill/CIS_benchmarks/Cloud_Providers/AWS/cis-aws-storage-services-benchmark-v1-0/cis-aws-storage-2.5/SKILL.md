---
name: cis-aws-storage-2.5
description: "Ensure creating snapshots of EBS volumes"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, ebs, snapshot, backup, disaster-recovery, data-replication]
cis_id: "2.5"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-2.3, cis-aws-storage-2.4]
prerequisites: [cis-aws-storage-2.1]
severity_boost: {}
---

# CIS Control 2.5: Ensure creating snapshots of EBS volumes (Manual)

## Profile Applicability

- **Level 2**

## Description

A snapshot is a backup of your EBS volume that captures its state at a specific point in time, storing only the data changes since the last snapshot to optimize storage costs and speed. Snapshots are crucial for data recovery, creating new EBS volumes, and replicating data across AWS regions for disaster recovery and high availability. Restoring from a snapshot allows you to create a new EBS volume and attach it to an EC2 instance in the same availability zone, ensuring data integrity and accessibility.

## Rationale

The rationale behind using EBS snapshots is to ensure efficient and cost-effective data backup and recovery. By capturing only the data changes since the last snapshot, storage costs are minimized and the backup process is expedited. Snapshots are essential for maintaining data integrity, facilitating quick recovery, and enabling seamless data replication across regions, thereby enhancing disaster recovery capabilities and operational resilience.

## Impact

Not utilizing EBS snapshots can lead to significant risks and drawbacks. Without snapshots, data recovery becomes more complex and time-consuming, increasing the risk of prolonged downtime in the event of data loss or system failure. Additionally, the absence of incremental backups can result in higher storage costs and inefficient use of resources. The lack of data replication across regions severely compromises disaster recovery efforts, making it challenging to maintain high availability and operational continuity. Overall, failing to use snapshots undermines data integrity, security, and the ability to quickly restore critical information.

## Audit Procedure

### Via AWS Management Console

To audit the use of EBS snapshots in AWS, follow these steps:

1. **Access the AWS Management Console**
   - Log in to your AWS account and navigate to the AWS Management Console

2. **Review EBS Snapshots**
   - Go to the EC2 Dashboard and select "Snapshots" under the "Elastic Block Store" section
   - Check the list of snapshots to ensure regular backups are being created for all critical volumes

3. **Verify Snapshot Policies**
   - Ensure that snapshot lifecycle policies are in place and configured correctly
   - Go to the "Lifecycle Manager" under the EC2 Dashboard and review policies for automated snapshot creation and retention

4. **Check Snapshot Status and Details**
   - Review the status of each snapshot to ensure they are completed successfully
   - Verify the details of snapshots, such as description, creation time, and the volume ID associated with each snapshot

5. **Inspect IAM Policies and Permissions**
   - Navigate to the IAM Dashboard and review the policies attached to users, groups, and roles to ensure they have appropriate permissions to create, delete, and manage snapshots

6. **Use AWS Config Rules**
   - Enable AWS Config to continuously monitor and record AWS resource configurations
   - Create AWS Config rules to check for compliance with best practices, such as ensuring snapshots are created regularly and are not older than a specific period

7. **Review AWS CloudTrail Logs**
   - Use AWS CloudTrail to review logs of API calls related to EBS snapshots
   - Ensure that all snapshot activities are logged and can be traced back to authorized users and roles

8. **Generate Reports**
   - Utilize AWS Config and AWS CloudTrail to generate compliance and activity reports
   - Review these reports to ensure adherence to snapshot policies and identify any anomalies or unauthorized activities

### Via AWS CLI

```bash
# List all EBS snapshots
aws ec2 describe-snapshots --owner-ids self \
  --query 'Snapshots[].[SnapshotId,VolumeId,StartTime,State,Description]' \
  --output table

# Find volumes without recent snapshots (example: no snapshot in last 7 days)
aws ec2 describe-volumes --query 'Volumes[].VolumeId' --output text | \
while read volume; do
  snapshot=$(aws ec2 describe-snapshots \
    --filters Name=volume-id,Values=$volume \
    --query 'Snapshots | sort_by(@, &StartTime) | [-1].StartTime' \
    --output text)
  echo "Volume: $volume, Latest Snapshot: $snapshot"
done

# Check snapshot lifecycle policies
aws dlm get-lifecycle-policies

# Verify snapshot encryption
aws ec2 describe-snapshots --owner-ids self \
  --query 'Snapshots[?Encrypted==`false`].[SnapshotId,VolumeId]' \
  --output table
```

## Expected Result

- Regular snapshots are created for all critical EBS volumes
- Snapshot lifecycle policies automate creation and retention
- Snapshots are encrypted if source volumes contain sensitive data
- Snapshots are replicated to other regions for disaster recovery
- Snapshot retention policies align with compliance requirements

## Remediation

### Via AWS Management Console

To create an EBS snapshot on AWS, follow these steps:

1. **Access the AWS Management Console**
   - Log in to your AWS account and navigate to the AWS Management Console

2. **Navigate to the EC2 Dashboard**
   - In the AWS Management Console, select "EC2" from the services menu to open the EC2 Dashboard

3. **Select the Volume**
   - In the left-hand navigation pane, under "Elastic Block Store," click on "Volumes"
   - Find the volume you want to snapshot from the list and select it by clicking the checkbox next to it

4. **Create a Snapshot**
   - With the volume selected, click on the "Actions" button at the top of the page
   - From the dropdown menu, select "Create Snapshot"

5. **Configure the Snapshot**
   - In the "Create Snapshot" dialog box, provide a description for the snapshot. This helps identify the snapshot later
   - Review the volume ID to ensure it is the correct volume

6. **Initiate the Snapshot Creation**
   - Click the "Create Snapshot" button to start the snapshot creation process

7. **Monitor the Snapshot**
   - Navigate to the "Snapshots" section under "Elastic Block Store" in the left-hand navigation pane
   - Find your snapshot in the list and monitor its status. The snapshot creation process might take some time, depending on the size of the volume and the amount of data

8. **Verify Completion**
   - Once the snapshot status changes to "completed," it indicates that the snapshot has been successfully created and is available for use

### Via AWS CLI

```bash
# Create a snapshot manually
aws ec2 create-snapshot \
  --volume-id vol-xxxxxxxxx \
  --description "Manual backup - $(date +%Y-%m-%d)" \
  --tag-specifications 'ResourceType=snapshot,Tags=[{Key=Name,Value=DataSnapshot},{Key=Backup,Value=Manual}]'

# Create snapshot lifecycle policy
aws dlm create-lifecycle-policy \
  --description "Daily EBS Snapshot Policy" \
  --state ENABLED \
  --execution-role-arn arn:aws:iam::ACCOUNT:role/AWSDataLifecycleManagerDefaultRole \
  --policy-details file://snapshot-policy.json

# Copy snapshot to another region for DR
aws ec2 copy-snapshot \
  --source-snapshot-id snap-xxxxxxxxx \
  --source-region us-east-1 \
  --region us-west-2 \
  --description "DR copy"
```

## Default Value

By default, no automatic snapshots are created. Users must manually create snapshots or configure Data Lifecycle Manager (DLM) policies.

## References

1. [Creating EBS Snapshots](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ebs-creating-snapshot.html)
2. [Automating the Amazon EBS Snapshot Lifecycle](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/snapshot-lifecycle.html)

## CIS Controls

| Controls Version | Control                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------- | ---- | ---- | ---- |
| v8               | 11.1 Establish and Maintain a Data Recovery Process | ●    | ●    | ●    |
| v7               | 10.1 Ensure Regular Automated Back Ups              | ●    | ●    | ●    |

## Notes

- This is a **manual** control requiring snapshot verification
- By following these steps, you can create an EBS snapshot to ensure you have a backup of your volume at a specific point in time
- Use AWS Data Lifecycle Manager to automate snapshot creation and retention
- Test snapshot restoration regularly to ensure recovery procedures work
- Consider using AWS Backup for centralized snapshot management across services
