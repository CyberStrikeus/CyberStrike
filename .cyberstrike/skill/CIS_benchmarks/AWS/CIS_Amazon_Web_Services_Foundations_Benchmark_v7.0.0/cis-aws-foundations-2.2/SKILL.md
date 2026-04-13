---
name: cis-aws-foundations-2.2
description: "Maintain current AWS account contact details"
category: cis-iam
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, iam, account, contact-details, billing]
cis_id: "2.2"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-2.3]
prerequisites: []
severity_boost: {}
---

# Maintain current AWS account contact details

## Description
Ensure contact email and telephone details for AWS accounts are current and mapped to more than one individual in your organization.

An AWS account supports a number of contact details, and AWS will use these to contact the account owner if activity judged to be in breach of the Acceptable Use Policy or indicative of a likely security compromise is observed by the AWS Abuse team. Contact details should not be associated with a single individual, as circumstances may arise where that individual is unavailable. Email contact details should point to a mail alias that forwards messages to multiple individuals within the organization; where feasible, phone contact details should point to a PABX hunt group or other call-forwarding system. In AWS Organizations environments, this applies to all member accounts, not just the management account.

## Rationale
If an AWS account is observed to be behaving in a prohibited or suspicious manner, AWS will attempt to contact the account owner by email and phone using the listed contact details. If this is unsuccessful and the account behavior requires urgent mitigation, proactive measures may be taken, including throttling traffic between the account exhibiting suspicious behavior and AWS API endpoints or the Internet. This may result in impaired service to and from the affected account. Therefore, it is in both the customer's and AWS's best interests to ensure that prompt contact can be established. This is best achieved by configuring AWS account contact details to point to resources that reach multiple individuals, such as email aliases and PABX hunt groups.

## Impact
Outdated contact details may delay incident response and lead to service disruption.

## Audit Procedure

### Using AWS Console
This activity can only be performed via the AWS Console, with a user who has permission to read and write Billing information (aws-portal:*Billing).

1. Sign in to the AWS Management Console and open the `Billing and Cost Management` console at https://console.aws.amazon.com/billing/home#/.
2. On the navigation bar, choose your account name, and then choose `Account`.
3. Under `Contact Information`, review and verify the current details.

### Using AWS CLI
1. Run the following command:

```bash
aws account get-contact-information
```

Expected output format:
```json
{
  "AddressLine1": "<AddressLine 1>",
  "AddressLine2": "<AddressLine 2>",
  "City": "<City>",
  "CompanyName": "<Company Name>",
  "CountryCode": "<Country Code>",
  "FullName": "<Full Name>",
  "PhoneNumber": "<Phone Number>",
  "PostalCode": "<Postal Code>",
  "StateOrRegion": "<State or Region>"
}
```

## Expected Result
Contact information is current, accurate, and mapped to shared resources (email aliases, group phone numbers) rather than a single individual.

## Remediation

### Using AWS Console
1. Sign in to the AWS Management Console and open the `Billing and Cost Management` console at https://console.aws.amazon.com/billing/home#/.
2. On the navigation bar, choose your account name, and then choose `Account`.
3. On the `Account Settings` page, next to `Account Settings`, choose `Edit`.
4. Next to the field that you need to update, choose `Edit`.
5. After you have entered your changes, choose `Save changes`.
6. After you have made your changes, choose `Done`.
7. To edit your contact information, under `Contact Information`, choose `Edit`.
8. For the fields that you want to change, type your updated information, and then choose `Update`.

### Using AWS CLI
Run the following command:

```bash
aws account get-contact-information '{
  "AddressLine1": "<AddressLine 1>",
  "AddressLine2": "<AddressLine 2>",
  "City": "<City>",
  "CompanyName": "<Company Name>",
  "CountryCode": "<Country Code>",
  "FullName": "<Full Name>",
  "PhoneNumber": "<Phone Number>",
  "PostalCode": "<Postal Code>",
  "StateOrRegion": "<State or Region>"
}'
```

## Default Value
By default, AWS account contact information (email and telephone) is set to the values provided at account creation. These usually reference a single individual rather than a shared alias or group contact. In AWS Organizations environments, this may vary across accounts unless centrally managed or periodically reviewed.

## References
1. https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/manage-account-settings.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 17.2 Establish and Maintain Contact Information for Reporting Security Incidents | x | x | x |
| v7 | 19.3 Designate Management Personnel to Support Incident Handling | x | x | x |

## Profile
Level 1 | Manual
