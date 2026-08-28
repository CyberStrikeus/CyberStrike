---
name: cis-aws-foundations-4.7
description: "Ensure VPC flow logging is enabled in all VPCs"
category: cis-logging
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, logging, vpc, flow-logs, network, cloudwatch]
cis_id: "4.7"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-4.1]
prerequisites: []
severity_boost: {}
---

# Ensure VPC flow logging is enabled in all VPCs

## Description

VPC Flow Logs is a feature that enables you to capture information about the IP traffic going to and from network interfaces in your VPC. After you've created a flow log, you can view and retrieve its data in Amazon CloudWatch Logs. It is recommended that VPC Flow Logs be enabled for packet "Rejects" for VPCs.

## Rationale

VPC Flow Logs provide visibility into network traffic that traverses the VPC and can be used to detect anomalous traffic or gain insights during security workflows.

## Impact

By default, CloudWatch Logs will store logs indefinitely unless a specific retention period is defined for the log group. When choosing the number of days to retain, keep in mind that the average time it takes for an organization to realize they have been breached is 210 days (at the time of this writing). Since additional time is required to research a breach, a minimum retention policy of 365 days allows for detection and investigation. You may also wish to archive the logs to a cheaper storage service rather than simply deleting them. See the following AWS resource to manage CloudWatch Logs retention periods:

1. https://docs.aws.amazon.com/AmazonCloudWatch/latest/DeveloperGuide/SettingLogRetention.html

## Audit Procedure

### Using AWS Console

1. Sign into the management console.
2. Select `Services`, then select `VPC`.
3. In the left navigation pane, select `Your VPCs`.
4. Select a VPC.
5. In the right pane, select the `Flow Logs` tab.
6. Ensure a Log Flow exists that has `Active` in the `Status` column.

### Using AWS CLI

1. Run the `describe-vpcs` command (OSX/Linux/UNIX) to list the VPC networks available in the current AWS region:

```bash
aws ec2 describe-vpcs --region <region> --query Vpcs[].VpcId
```

The command output returns the `VpcId` of VPCs available in the selected region.

2. Run the `describe-flow-logs` command (OSX/Linux/UNIX) using the VPC ID to determine if the selected virtual network has the Flow Logs feature enabled:

```bash
aws ec2 describe-flow-logs --filter "Name=resource-id,Values=<vpc-id>"
```

If there are no Flow Logs created for the selected VPC, the command output will return an empty list `[]`.

3. Repeat step 2 for other VPCs in the same region.
4. Change the region by updating `--region`, and repeat steps 1-4 for each region.
5. Alternatively, the following command can be used to identify VPCs with and without Flow Logs:

```bash
VPCS=$(aws ec2 describe-vpcs --query "Vpcs[].VpcId" --output text)

for VPC in $VPCS; do
  COUNT=$(aws ec2 describe-flow-logs --filter Name=resource-id,Values=$VPC --query "length(FlowLogs)" --output text)

  if [ "$COUNT" -gt 0 ]; then
    echo "$VPC True"
  else
    echo "$VPC False"
  fi
done
```

## Expected Result

All VPCs in all regions have at least one active Flow Log configured.

## Remediation

### Using AWS Console

1. Sign into the management console.
2. Select `Services`, then select `VPC`.
3. In the left navigation pane, select `Your VPCs`.
4. Select a VPC.
5. In the right pane, select the `Flow Logs` tab.
6. If no Flow Log exists, click `Create Flow Log`.
7. For Filter, select `Reject`.
8. Enter a `Role` and `Destination Log Group`.
9. Click `Create Log Flow`.
10. Click on `CloudWatch Logs Group`.

**Note:** Setting the filter to "Reject" will dramatically reduce the accumulation of logging data for this recommendation and provide sufficient information for the purposes of breach detection, research, and remediation. However, during periods of least privilege security group engineering, setting the filter to "All" can be very helpful in discovering existing traffic flows required for the proper operation of an already running environment.

### Using AWS CLI

1. Create a policy document, name it `role_policy_document.json`, and paste the following content:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "test",
      "Effect": "Allow",
      "Principal": {
        "Service": "vpc-flow-logs.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

2. Create another policy document, name it `iam_policy.json`, and paste the following content:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
        "logs:PutLogEvents",
        "logs:GetLogEvents",
        "logs:FilterLogEvents"
      ],
      "Resource": "*"
    }
  ]
}
```

3. Run the following command to create an IAM role:

```bash
aws iam create-role --role-name <aws-support-iam-role> --assume-role-policy-document file://<file-path>role_policy_document.json
```

4. Run the following command to create an IAM policy:

```bash
aws iam create-policy --policy-name <iam-policy-name> --policy-document file://<file-path>iam_policy.json
```

5. Run the `attach-group-policy` command, using the IAM policy ARN returned from the previous step to attach the policy to the IAM role:

```bash
aws iam attach-group-policy --policy-arn arn:aws:iam::<aws-account-id>:policy/<iam-policy-name> --group-name <group-name>
```

6. Run the `describe-vpcs` command to get a list of VPCs in the selected region:

```bash
aws ec2 describe-vpcs --region <region>
```

7. Run the `create-flow-logs` command to create a flow log for a VPC:

```bash
aws ec2 create-flow-logs --resource-type VPC --resource-ids <vpc-id> --traffic-type REJECT --log-group-name <log-group-name> --deliver-logs-permission-arn <iam-role-arn>
```

8. Repeat step 7 for other VPCs in the selected region.
9. Change the region by updating --region, and repeat the remediation procedure for each region.

## Default Value

By default, VPC Flow Logs are not enabled for any newly created VPCs. Logging must be manually configured on a per-VPC basis.

## References

1. CCE-79202-8
2. https://docs.aws.amazon.com/AmazonVPC/latest/UserGuide/flow-logs.html

## CIS Controls

| Controls Version | Control                                                                                                                                                                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 8.2 Collect Audit Logs - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets.                                     | x    | x    | x    |
| v8               | 13.6 Collect Network Traffic Flow Logs - Collect network traffic flow logs and/or network traffic to review and alert upon from network devices.                                                    |      | x    | x    |
| v7               | 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices.                                                                                      | x    | x    | x    |
| v7               | 12.5 Configure Monitoring Systems to Record Network Packets - Configure monitoring systems to record network packets passing through the boundary at each of the organization's network boundaries. |      | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
|                             |         | M1047       |

## Profile

Level 2 | Automated
