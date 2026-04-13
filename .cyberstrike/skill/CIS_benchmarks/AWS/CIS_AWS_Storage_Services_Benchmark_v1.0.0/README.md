# CIS AWS Storage Services Benchmark v1.0.0 - Skills

This directory contains CyberStrike skills for CIS AWS Storage Services Benchmark v1.0.0, Section 1 (AWS Backup) and Section 2 (EBS) controls.

## Created Skills

### Section 1: AWS Backup (Controls 1.1-1.6)

- **1.1** - AWS Storage Backups
- **1.2** - Ensure securing AWS Backups
- **1.3** - Ensure to create backup template and name
- **1.4** - Ensure to create AWS IAM Policies
- **1.5** - Ensure to create IAM roles for Backup
- **1.6** - Ensure AWS Backup with Service Linked Roles

### Section 2: Elastic Block Store (EBS) (Controls 2.1-2.13)

- **2.1** - Ensure creating EC2 instance with EBS
- **2.2** - Ensure configuring Security Groups
- **2.3** - Ensure the proper configuration of EBS storage
- **2.4** - Ensure the creation of a new volume
- **2.5** - Ensure creating snapshots of EBS volumes
- **2.6** - Ensure Proper IAM Configuration for EC2 Instances
- **2.7** - Ensure creating IAM User
- **2.8** - Ensure the Creation of IAM Groups
- **2.9** - Ensure Granular Policy Creation
- **2.10** - Ensure Resource Access via Tag-based Policies
- **2.11** - Ensure Secure Password Policy Implementation
- **2.12** - Ensure Monitoring EC2 and EBS with CloudWatch
- **2.13** - Ensure creating an SNS subscription

## Total: 19 Controls

All controls are **Manual** (Level 2) requiring human verification and configuration.

## Source

CIS AWS Storage Services Benchmark v1.0.0
- PDF Location: `/Users/orhanyildirim/Desktop/CIS benchmarks/CIS_AWS_Storage_Services_Benchmark_v1.0.0.pdf`
- Pages: 12-56

## Structure

Each control is in a separate directory:
```
cis-aws-storage-{id}/
  └── SKILL.md
```

## Usage

These skills can be used in CyberStrike for:
- AWS security assessments
- Compliance audits
- Security posture validation
- Automated testing workflows

## Author

cyberstrike-official

## Created

2026-04-12
