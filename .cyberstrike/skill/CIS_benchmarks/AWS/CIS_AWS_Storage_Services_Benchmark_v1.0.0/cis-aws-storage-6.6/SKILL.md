---
name: cis-aws-storage-6.6
description: "Ensure installation of the AWS Replication Agent"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, edr, replication-agent, installation, agent-deployment]
cis_id: "6.6"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-6.4, cis-aws-storage-6.5, cis-aws-storage-6.7]
prerequisites: []
severity_boost: {}
---

# CIS 6.6: Ensure installation of the AWS Replication Agent (Manual)

## Profile Applicability

- **Level:** 2

## Description

Set up and verify the installation of the AWS Replication Agent on all relevant systems to facilitate efficient and reliable data replication. This process includes downloading the agent, configuring it according to best practices, and ensuring it is correctly integrated with your AWS environment. Regularly check the agent's performance and update it as needed to maintain optimal functionality and data integrity during replication processes.

## Rationale

Installing the AWS Replication Agent is crucial for enabling efficient and reliable data replication, ensuring that critical data is accurately duplicated across systems. Proper configuration and integration with your AWS environment optimize the agent's performance, enhancing data availability and disaster recovery capabilities. Regular checks and updates of the replication agent help maintain its effectiveness, ensuring data integrity and minimizing the risk of replication failures.

## Impact

Agent installation and maintenance requires:

- Agent download and installation on all source servers
- Proper configuration aligned with best practices
- Network connectivity verification
- Ongoing performance monitoring
- Regular agent updates
- IAM credentials for agent authentication

## Audit Procedure

### Via AWS Console

1. **Obtain Agent Installer Link:**
   - On the source servers page, from Actions, choose add servers to obtain the agent installer link.

2. **Download Agent Installer:**
   - On your source server (in our case, the EC2 instance that was already created) download the appropriate agent installer for your operating system.
   - For Linux instance on US-East-1, substitute your region in the {Region} brackets of this command:

```bash
wget -O ./aws-replication-installer-init https://aws-elastic-disaster-recovery-{Region}.s3.{Region}.amazonaws.com/latest/linux/aws-replication-installer-init
```

3. **Run Installation Command:**

```bash
chmod +x aws-replication-installer-init; sudo ./aws-replication-installer-init
```

4. **Enter Region:**
   - Type in your region. Region is case sensitive; if you're in us-east-1, make sure you type "us-east-1".

5. **Provide IAM Credentials:**
   - If you're using SSH, you will be prompted with your activation ID and secret activation key.
   - Make sure you have those accessible for the IAM user you're using.
   - You can generate a new key from the IAM dashboard if you forgot to save your key.

6. **Select Replication Scope:**
   - Select "Enter" to replicate all servers.

7. **Verify Replication Status:**
   - All servers should replicate.

8. **Verify Installation:**
   - Make sure your OS is up to date. If you run into an error replicating your devices, view the documentation on troubleshooting the AWS replication installation here: [https://docs.aws.amazon.com/mgn/latest/ug/installation-requirements.html](https://docs.aws.amazon.com/mgn/latest/ug/installation-requirements.html)

9. **Confirm Installation Success:**
   - If install runs successfully, the source server will appear in your Elastic Disaster Recovery Console dashboard on the "source servers" page.
   - This will signify the beginning of the replication process.

## Expected Result

- Agent installer link obtained from AWS console
- Agent installer downloaded on all source servers
- Agent installation completed successfully
- Region configured correctly (case-sensitive)
- IAM credentials provided and authenticated
- All target servers selected for replication
- All servers showing "replicate" status
- Source servers appearing in EDR Console dashboard
- Replication process initiated
- No installation errors
- OS is up to date on all source servers

## Remediation

### Via AWS Console

1. **Obtain and Download Agent:**
   - Access source servers page in EDR console
   - Choose "add servers" from Actions menu
   - Download appropriate agent installer for your OS

2. **Install Agent (Linux Example):**

```bash
# Download installer
wget -O ./aws-replication-installer-init https://aws-elastic-disaster-recovery-{Region}.s3.{Region}.amazonaws.com/latest/linux/aws-replication-installer-init

# Make executable and run
chmod +x aws-replication-installer-init; sudo ./aws-replication-installer-init
```

3. **Configure Agent:**
   - Enter region (case-sensitive, e.g., "us-east-1")
   - Provide IAM activation ID and secret key
   - Select servers to replicate (Enter for all)

4. **Verify Installation:**
   - Check server replication status
   - Verify source server appears in EDR dashboard
   - Confirm replication process has started
   - Review logs for any errors

5. **Troubleshoot if Needed:**
   - Update OS if installation fails
   - Review troubleshooting documentation
   - Verify network connectivity
   - Confirm IAM permissions

## Default Value

By default, the AWS Replication Agent is not installed. Organizations must manually download, install, and configure the agent on all source servers.

## References

- [AWS Elastic Disaster Recovery Agent Installation](https://docs.aws.amazon.com/mgn/latest/ug/agent-installation.html)
- [AWS EDR Installation Requirements](https://docs.aws.amazon.com/mgn/latest/ug/installation-requirements.html)
- [Troubleshooting AWS Replication Installation](https://docs.aws.amazon.com/mgn/latest/ug/installation-requirements.html)

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 6.7 Centralize Access Control<br/>Centralize access control for all enterprise assets through a directory service or SSO provider, where supported.                                                                                                                                                                                                                                                                            |      | ●    | ●    |
| v8               | 6.8 Define and Maintain Role-Based Access Control<br/>Define and maintain role-based access control, through determining and documenting the access rights necessary for each role within the enterprise to successfully carry out its assigned duties. Perform access control reviews of enterprise assets to validate that all privileges are authorized, on a recurring schedule at a minimum annually, or more frequently. |      |      | ●    |
| v7               | 3.4 Deploy Automated Operating System Patch Management Tools<br/>Deploy automated software update tools in order to ensure that the operating systems are running the most recent security updates provided by the software vendor.                                                                                                                                                                                            | ●    | ●    | ●    |
| v7               | 5.4 Deploy System Configuration Management Tools<br/>Deploy system configuration management tools that will automatically enforce and redeploy configuration settings to systems at regularly scheduled intervals.                                                                                                                                                                                                             |      | ●    | ●    |

## Profile

- Level 2
