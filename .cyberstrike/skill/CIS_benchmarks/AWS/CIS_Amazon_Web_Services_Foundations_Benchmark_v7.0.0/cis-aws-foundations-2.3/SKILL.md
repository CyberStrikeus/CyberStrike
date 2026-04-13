---
name: cis-aws-foundations-2.3
description: "Ensure security contact information is registered"
category: cis-iam
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, iam, account, security-contact, alternate-contact]
cis_id: "2.3"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-2.2]
prerequisites: []
severity_boost: {}
---

# Ensure security contact information is registered

## Description

AWS provides customers with the option to specify contact information for the account's security team. It is recommended that this information be configured. In AWS Organizations environments, this applies to all member accounts.

## Rationale

Specifying security-specific contact information helps ensure that security advisories sent by AWS reach the team within your organization that is best equipped to respond to them.

## Impact

Missing or incorrect security contact information may delay response to AWS security notifications, increasing the risk of prolonged exposure to security threats.

## Audit Procedure

### Using AWS Console

1. Click on your account name at the top right corner of the console.
2. From the drop-down menu, Click `Account`.
3. Scroll down to the `Alternate Contacts` section.
4. Ensure contact information is specified in the `Security contact` section.

### Using AWS CLI

1. Run the following command:

```bash
aws account put-alternate-contact --alternate-contact-type SECURITY --email-address "" --name "" --phone-number ""
```

2. Ensure proper contact information is specified for the `Security` contact.

## Expected Result

Security contact information is configured with valid email, name, and phone number for the security team. The email should ideally be a distribution list monitored by more than one individual.

## Remediation

### Using AWS Console

1. Click on your account name at the top right corner of the console.
2. From the drop-down menu click `My Account`.
3. Scroll down to the `Alternate Contacts` section.
4. Enter contact information in the `Security` section.

### Using AWS CLI

Run the following command with the following input parameters: --email-address, --name, and --phone-number.

```bash
aws account put-alternate-contact --alternate-contact-type SECURITY --email-address "" --name "" --phone-number ""
```

**Note:** Consider specifying an internal email distribution list to ensure emails are regularly monitored by more than one individual.

## Default Value

By default, no alternate security contact information is configured for an AWS account. If not specified, only the primary account contact provided at account creation will be used. In AWS Organizations environments, this may vary across accounts unless centrally managed or periodically reviewed.

## References

1. CCE-79200-2

## CIS Controls

| Controls Version | Control                                                                          | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 17.2 Establish and Maintain Contact Information for Reporting Security Incidents | x    | x    | x    |
| v8               | 17.6 Define Mechanisms for Communicating During Incident Response                |      | x    | x    |
| v7               | 19 Incident Response and Management                                              |      |      |      |
| v7               | 19.2 Assign Job Titles and Duties for Incident Response                          |      | x    | x    |

## Profile

Level 1 | Manual
