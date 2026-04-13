# CIS AWS Storage Services Benchmark v1.0.0 - Section 6 Summary

## Section 6: Elastic Disaster Recovery (EDR)

**Total Controls:** 13 (6.1 - 6.13)
**Profile Level:** All Level 2
**Status:** ✅ Complete

### Control List

| Control | Title | Tags |
|---------|-------|------|
| 6.1 | Ensure Elastic Disaster Recovery is Configured | backup, resilience, business-continuity |
| 6.2 | Ensure AWS Disaster Recovery Configuration | network, architecture, vpc, replication |
| 6.3 | Ensure functionality of Endpoint Detection and Response (EDR) | endpoint-detection, security, threat-detection, malware |
| 6.4 | Ensure configuration of replication settings | replication, data-duplication, bandwidth, rto, rpo |
| 6.5 | Ensure proper IAM configuration for AWS Elastic Disaster Recovery | iam, access-control, mfa, least-privilege, authentication |
| 6.6 | Ensure installation of the AWS Replication Agent | replication-agent, installation, agent-deployment |
| 6.7 | Ensure proper configuration of the Launch Settings | launch-settings, ec2, configuration, startup |
| 6.8 | Ensure execution of a recovery drill | disaster-recovery, drill, testing, recovery-testing, rto, rpo |
| 6.9 | Ensure Continuous Disaster Recovery Operations | continuous-operations, monitoring, backup, replication |
| 6.10 | Ensure execution of a Disaster Recovery Failover | failover, recovery, business-continuity |
| 6.11 | Ensure execution of a failback | failback, recovery, restoration |
| 6.12 | Ensure CloudWatch Metrics for AWS EDR | cloudwatch, monitoring, metrics, logging, alerting |
| 6.13 | Ensure working of EDR | verification, testing, functionality |

### Key Themes

1. **EDR Configuration** (6.1, 6.2, 6.13)
   - Initial setup and network architecture
   - Complete EDR functionality verification

2. **IAM & Security** (6.5)
   - Least-privilege access
   - MFA enforcement
   - Role-based access control

3. **Agent & Replication** (6.3, 6.4, 6.6)
   - Replication agent installation
   - Replication settings configuration
   - Network connectivity

4. **Launch & Recovery** (6.7, 6.8, 6.10, 6.11)
   - Launch settings configuration
   - Recovery drill execution
   - Failover procedures
   - Failback processes

5. **Continuous Operations** (6.9, 6.12)
   - Ongoing DR operations
   - CloudWatch monitoring
   - Metrics and alerting

### Common CIS Controls Mappings

- **v8 11.2** - Perform Automated Backups
- **v8 11.4** - Establish and Maintain an Isolated Instance of Recovery Data
- **v8 11.5** - Test Data Recovery
- **v7 10.2** - Perform Complete System Backups
- **v7 10.4** - Ensure Protection of Backups

### Network Requirements

All EDR controls require proper network configuration:
- **TCP 443** - HTTPS access to EDR, S3, EC2 endpoints
- **TCP 1500** - Replication traffic between source and staging area

### Files Created

```
CIS_AWS_Storage_Services_Benchmark_v1.0.0/
├── cis-aws-storage-6.1/SKILL.md
├── cis-aws-storage-6.2/SKILL.md
├── cis-aws-storage-6.3/SKILL.md
├── cis-aws-storage-6.4/SKILL.md
├── cis-aws-storage-6.5/SKILL.md
├── cis-aws-storage-6.6/SKILL.md
├── cis-aws-storage-6.7/SKILL.md
├── cis-aws-storage-6.8/SKILL.md
├── cis-aws-storage-6.9/SKILL.md
├── cis-aws-storage-6.10/SKILL.md
├── cis-aws-storage-6.11/SKILL.md
├── cis-aws-storage-6.12/SKILL.md
└── cis-aws-storage-6.13/SKILL.md
```

### Usage in CyberStrike

These skills can be invoked in CyberStrike to audit AWS EDR configurations:

```bash
# Audit all Section 6 controls
cyberstrike run "Audit CIS AWS Storage Section 6 controls"

# Audit specific control
cyberstrike run "Check CIS 6.1 - EDR Configuration"

# Remediate specific control
cyberstrike run "Remediate CIS 6.5 - IAM for EDR"
```

---

**Generated:** 2026-04-12
**Source:** CIS AWS Storage Services Benchmark v1.0.0 (Pages 111-141)
**Author:** cyberstrike-official
