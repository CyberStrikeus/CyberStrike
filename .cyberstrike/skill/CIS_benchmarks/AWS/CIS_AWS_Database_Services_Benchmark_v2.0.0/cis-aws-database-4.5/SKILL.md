---
name: cis-aws-database-4.5
description: "Ensure VPC Endpoints are configured"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, dynamodb, vpc, endpoint, network-security]
cis_id: "4.5"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-4.4]
prerequisites: []
severity_boost: {}
---

# 4.5 Ensure VPC Endpoints are configured

## Description
Using VPC endpoints with Amazon DynamoDB allows you to securely access DynamoDB resources within your Amazon Virtual Private Cloud (VPC). This keeps your traffic off the public internet.

## Rationale
Using VPC endpoint in the DynamoDB helps ensure that the data is secured and that no external networks would have access to the network. It is a private network where the user has access to their desired availability zones and subnets.

## Impact
N/A

## Audit Procedure

### Using AWS Console
1. Open Amazon VPC Console
   - Sign in to the AWS Management Console and open the Amazon VPC console at https://console.aws.amazon.com/vpc/.

2. Create a VPC Endpoint
   - In the Amazon VPC console, navigate to the `Endpoints` section in the left-side menu.
   - Click `Create Endpoint`.
   - Select your desired VPC in the `VPC` dropdown menu.
   - In the `Service category` section, choose `AWS services`.
   - In the `Filter Services` search box, enter `DynamoDB` and select `DynamoDB` from the results.
   - Choose your desired availability zone(s) and subnet(s).
   - Leave the default settings for other options or customize them according to your requirements.
   - Click `Create endpoint`.

3. Update Route Tables
   - In the Amazon VPC console, navigate to the `Route Tables` section in the left-side menu.
   - Find the route table associated with your VPC or subnet from which you want to access DynamoDB.
   - Edit the route table and add a route for the DynamoDB VPC endpoint.
     - Destination: Enter the CIDR block of the DynamoDB VPC endpoint, typically in the form of `vpce-xxxxxx-xxxxxxx-xxxxxxx-xxxxxxx.vpce.amazonaws.com/32`.
     - Target: Select the VPC endpoint ID from the dropdown menu.
   - Save the changes to update the route table.

4. Verify Connectivity
   - To ensure that your VPC endpoint for DynamoDB is functioning correctly:
   - Launch an Amazon EC2 instance within your VPC or use an existing one.
   - Connect to the EC2 instance using SSH or other remote access methods.
   - From the EC2 instance, try to access DynamoDB using the SDK or CLI.
   - Ensure that the access to DynamoDB is successful and that data can be retrieved or modified.

## Expected Result
A VPC Gateway Endpoint for DynamoDB is configured, and route tables are updated to route DynamoDB traffic through the VPC endpoint instead of the public internet.

## Remediation

### Using AWS Console
Follow the same steps as the audit procedure to create a VPC endpoint for DynamoDB and update route tables accordingly.

## Default Value
By default, no VPC endpoints are configured. DynamoDB traffic goes through the public internet.

## Additional Information
Amazon DynamoDB uses Gateway VPC Endpoints, unlike other services that may offer Interface VPC Endpoints. There are some differences such as Gateway VPC Endpoints do not permit cross-region communication. See AWS's Documentation for more information.

## References
1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 12.2 Establish and Maintain a Secure Network Architecture | | x | x |
| v7 | 11.7 Manage Network Infrastructure Through a Dedicated Network | | x | x |

## Profile
Level 1 | Manual
