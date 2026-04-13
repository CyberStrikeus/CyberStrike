# CIS AWS End User Compute Services Benchmark v1.2.0 - Skills

This directory contains CyberStrike skills for the CIS AWS End User Compute Services Benchmark v1.2.0.

## Coverage Summary

### Section 2: WorkSpaces (18 controls)
- 2.1 - 2.18: WorkSpaces configuration and security controls

### Section 3: WorkSpaces Web (1 control)
- 3.1: User Access Logging

### Section 4: WorkDocs (8 controls)
- 4.1: Ensure Administrators of WorkDocs is defined using IAM (Automated)
- 4.2: Ensure MFA is enabled for WorkDoc users (Manual)
- 4.3: Ensure Workdocs access is limited to a range of allowable IP addresses (Manual)
- 4.4: Utilize site wide activity feed for monitoring (Manual)
- 4.5: Ensure new users can only be invited from allowed domains (Manual)
- 4.6: Ensure only specific users are allowed to invite external users (Manual)
- 4.7: Ensure publicly shareable links is not allowed in WorkDocs (Manual)
- 4.8: Ensure any user that has not accessed WorkDocs in 30 days is set to inactive (Manual)

### Section 5: AppStream 2.0 (7 controls)
- 5.1: Ensure AppStream is utilizing its own virtual private cloud (VPC) (Manual)
- 5.2: Ensure a VPC Endpoint is set for AppStream (Manual)
- 5.3: Ensure maximum session duration is no longer than 10 hours (Automated)
- 5.4: Ensure session disconnect timeout is set to 5 minutes or less (Automated)
- 5.5: Ensure session Idle disconnect timeout is set to 10 minutes or less (Automated)
- 5.6: Ensure internet access is granted and managed through your VPC (Automated)
- 5.7: Ensure Operating system updates are applied to your base image every 30 days (Manual)

## Total Controls: 34

## Skill Directory Structure

```
CIS_AWS_End_User_Compute_Services_Benchmark_v1.2.0/
├── cis-aws-euc-2.1/SKILL.md
├── cis-aws-euc-2.2/SKILL.md
├── ...
├── cis-aws-euc-4.1/SKILL.md  ← WorkDocs controls
├── cis-aws-euc-4.2/SKILL.md
├── ...
├── cis-aws-euc-4.8/SKILL.md
├── cis-aws-euc-5.1/SKILL.md  ← AppStream 2.0 controls
├── cis-aws-euc-5.2/SKILL.md
├── ...
└── cis-aws-euc-5.7/SKILL.md
```

## Usage

Each skill can be invoked individually via CyberStrike CLI:

```bash
cyberstrike run cis-aws-euc-4.1  # WorkDocs IAM admin control
cyberstrike run cis-aws-euc-5.1  # AppStream VPC control
```

## Metadata

- **Benchmark:** CIS AWS End User Compute Services Benchmark
- **Version:** 1.2.0
- **Author:** cyberstrike-official
- **Category:** cis-end-user-compute
- **Tech Stack:** aws
- **Services Covered:** WorkSpaces, WorkDocs, AppStream 2.0, WorkSpaces Web

## References

- [CIS AWS End User Compute Services Benchmark](https://www.cisecurity.org/benchmark/amazon_web_services)
- [AWS WorkDocs Documentation](https://docs.aws.amazon.com/workdocs/)
- [AWS AppStream 2.0 Documentation](https://docs.aws.amazon.com/appstream2/)
