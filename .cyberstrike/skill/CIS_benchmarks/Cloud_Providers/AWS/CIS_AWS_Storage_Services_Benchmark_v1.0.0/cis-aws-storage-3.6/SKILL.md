---
name: cis-aws-storage-3.6
description: "Ensure Secure Ports for AWS storage services (S3, EFS, EBS)"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, efs, s3, ebs, ports, security-groups, nacl, network-security]
cis_id: "3.6"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-3.4, cis-aws-storage-3.5]
prerequisites: []
severity_boost: {}
---

# 3.6 Ensure Secure Ports (Manual)

## Profile Applicability

- Level 2

## Description

Securing network ports is essential for protecting AWS storage services like Amazon S3, EFS, and EBS. By configuring security groups and network access control lists (NACLs) to allow only necessary traffic, you minimize the risk of unauthorized access. Regular audits and monitoring of port usage ensure that only approved ports and protocols are operational, enhancing the overall security of your AWS storage environment.

## Rationale

By limiting traffic to only necessary and approved ports and protocols, you reduce the attack surface and enhance the overall security of your storage environment. Regular audits and monitoring further ensure that security measures remain effective and up-to-date, safeguarding your data from emerging threats.

## Impact

Not securing network ports in AWS storage services can lead to significant vulnerabilities, exposing your data to unauthorized access and potential breaches. This lack of control increases the risk of malicious attacks, such as port scanning and exploitation of open ports, which can result in data loss, corruption, and theft. Consequently, your organization may face severe financial losses, operational disruptions, and damage to its reputation.

## Audit Procedure

### Console

1. **Review Security Group Configurations**:
   1. Navigate to "Security Groups" under "Network & Security".
   2. Verify that security groups are configured to allow only necessary inbound and outbound traffic.
   3. Ensure rules are in place to restrict access to critical storage services, such as Amazon S3, EFS, and EBS.

2. **Check Network Access Control Lists (NACLs)**:
   - Steps:
     1. Navigate to "Network ACLs" under "Security".
     2. Ensure NACLs are configured to control traffic to and from subnets, allowing only necessary ports and protocols.
     3. Verify that rules are implemented to deny unauthorized access.

3. **Monitor VPC Flow Logs**:
   - Steps:
     1. Enable VPC Flow Logs for each VPC.
     2. Regularly review flow logs to monitor traffic and identify any unauthorized access attempts or anomalies.
     3. Investigate and remediate any unusual traffic patterns.

4. **Inspect IAM Policies and Roles**:
   - Steps:
     1. Review IAM policies to ensure they enforce least privilege principles for access to security groups and NACLs.
     2. Verify that roles are appropriately assigned and used to control access to security groups and NACLs.

5. **Enable and Review AWS CloudTrail Logs**:
   - Steps:
     1. Ensure CloudTrail is enabled in all regions.
     2. Regularly review CloudTrail logs for any changes to security groups, NACLs, and IAM policies.
     3. Set up alerts for critical security events related to port configurations.

6. **Conduct Regular Penetration Testing**:
   - Steps:
     1. Conduct tests to identify vulnerabilities in port configurations.
     2. Review findings and implement necessary security measures to address identified issues.
     3. Ensure compliance with AWS penetration testing policies.

7. **Verify Encryption in Transit**:
   - Steps:
     1. Ensure that data encryption is enabled for data in transit.
     2. Verify that encryption keys are managed securely using AWS Key Management Service (KMS).
     3. Check that all communication with storage services is encrypted.

8. **Implement and Review Security Best Practices**:
   - Steps:
     1. Implement recommended best practices for securing network ports and storage services.
     2. Regularly review and update security configurations to align with evolving best practices.
     3. Conduct periodic training for staff on security best practices and AWS configurations.

## Expected Result

- Security Groups should allow only necessary ports (e.g., NFS port 2049 for EFS, HTTPS 443 for S3)
- Network ACLs should be configured to control traffic appropriately
- VPC Flow Logs should be enabled and monitored
- CloudTrail should be enabled for audit logging
- No unauthorized ports should be open
- Encryption in transit should be enabled

## Remediation

### Console

1. Configure Security Groups to allow only necessary ports
2. Configure Network ACLs to control traffic to/from subnets
3. Enable VPC Flow Logs for monitoring
4. Enable CloudTrail for audit logging
5. Implement encryption in transit
6. Conduct regular security reviews and penetration testing

## Default Value

By default, AWS creates a default security group for each VPC that allows all outbound traffic and all inbound traffic from instances in the same security group. Custom security groups and NACLs must be configured to restrict traffic to only necessary ports.

## References

1. https://docs.aws.amazon.com/efs/latest/ug/NFS-access-control-efs.html

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists<br/>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                              | ●    | ●    | ●    |
| v8               | 13.9 Deploy Port-Level Access Control<br/>Deploy port-level access control. Port-level access control utilizes 802.1x, or similar network access control protocols, such as certificates, and may incorporate user and/or device authentication.                                                               |      |      | ●    |
| v7               | 1.7 Deploy Port Level Access Control<br/>Utilize port level access control, following 802.1x standards, to control which devices can authenticate to the network. The authentication system shall be tied into the hardware asset inventory data to ensure only authorized devices can connect to the network. |      | ●    | ●    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running<br/>Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.                                                                                                |      | ●    | ●    |

## Profile

Level 2
