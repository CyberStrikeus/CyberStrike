# cyberstrike - Master Penetration Testing Checklist

This is the master guide for all penetration testing activities. Each category links to detailed checklists.

## Web Application Testing (WSTG)

### WSTG-INFO: Information Gathering (10 tests)
- [ ] WSTG-INFO-01: Conduct Search Engine Discovery
- [ ] WSTG-INFO-02: Fingerprint Web Server
- [ ] WSTG-INFO-03: Review Webserver Metafiles
- [ ] WSTG-INFO-04: Enumerate Applications on Webserver
- [ ] WSTG-INFO-05: Review Webpage Content for Information Leakage
- [ ] WSTG-INFO-06: Identify Application Entry Points
- [ ] WSTG-INFO-07: Map Execution Paths Through Application
- [ ] WSTG-INFO-08: Fingerprint Web Application Framework
- [ ] WSTG-INFO-09: Fingerprint Web Application
- [ ] WSTG-INFO-10: Map Application Architecture

### WSTG-CONF: Configuration Testing (13 tests)
- [ ] WSTG-CONF-01: Test Network Infrastructure Configuration
- [ ] WSTG-CONF-02: Test Application Platform Configuration
- [ ] WSTG-CONF-03: Test File Extensions Handling
- [ ] WSTG-CONF-04: Review Old Backup and Unreferenced Files
- [ ] WSTG-CONF-05: Enumerate Infrastructure and Application Admin Interfaces
- [ ] WSTG-CONF-06: Test HTTP Methods
- [ ] WSTG-CONF-07: Test HTTP Strict Transport Security
- [ ] WSTG-CONF-08: Test RIA Cross Domain Policy
- [ ] WSTG-CONF-09: Test File Permission
- [ ] WSTG-CONF-10: Test for Subdomain Takeover
- [ ] WSTG-CONF-11: Test Cloud Storage
- [ ] WSTG-CONF-12: Test for Content Security Policy
- [ ] WSTG-CONF-13: Test for Path Confusion

### WSTG-IDNT: Identity Management (5 tests)
- [ ] WSTG-IDNT-01: Test Role Definitions
- [ ] WSTG-IDNT-02: Test User Registration Process
- [ ] WSTG-IDNT-03: Test Account Provisioning Process
- [ ] WSTG-IDNT-04: Testing for Account Enumeration
- [ ] WSTG-IDNT-05: Testing for Weak or Unenforced Username Policy

### WSTG-ATHN: Authentication Testing (11 tests)
- [ ] WSTG-ATHN-01: Testing for Credentials Transported over Encrypted Channel
- [ ] WSTG-ATHN-02: Testing for Default Credentials
- [ ] WSTG-ATHN-03: Testing for Weak Lock Out Mechanism
- [ ] WSTG-ATHN-04: Testing for Bypassing Authentication Schema
- [ ] WSTG-ATHN-05: Testing for Vulnerable Remember Password
- [ ] WSTG-ATHN-06: Testing for Browser Cache Weaknesses
- [ ] WSTG-ATHN-07: Testing for Weak Password Policy
- [ ] WSTG-ATHN-08: Testing for Weak Security Question Answer
- [ ] WSTG-ATHN-09: Testing for Weak Password Change or Reset
- [ ] WSTG-ATHN-10: Testing for Weaker Authentication in Alternative Channel
- [ ] WSTG-ATHN-11: Testing Multi-Factor Authentication

### WSTG-AUTHZ: Authorization Testing (7 tests)
- [ ] WSTG-AUTHZ-01: Testing Directory Traversal File Include
- [ ] WSTG-AUTHZ-02: Testing for Bypassing Authorization Schema
- [ ] WSTG-AUTHZ-03: Testing for Privilege Escalation
- [ ] WSTG-AUTHZ-04: Testing for Insecure Direct Object References
- [ ] WSTG-AUTHZ-05: Testing for OAuth Weaknesses
- [ ] WSTG-AUTHZ-06: Testing for GraphQL API Vulnerabilities
- [ ] WSTG-AUTHZ-07: Testing for Missing Function Level Access Control

### WSTG-SESS: Session Management (11 tests)
- [ ] WSTG-SESS-01: Testing for Session Management Schema
- [ ] WSTG-SESS-02: Testing for Cookies Attributes
- [ ] WSTG-SESS-03: Testing for Session Fixation
- [ ] WSTG-SESS-04: Testing for Exposed Session Variables
- [ ] WSTG-SESS-05: Testing for Cross Site Request Forgery
- [ ] WSTG-SESS-06: Testing for Logout Functionality
- [ ] WSTG-SESS-07: Testing Session Timeout
- [ ] WSTG-SESS-08: Testing for Session Puzzling
- [ ] WSTG-SESS-09: Testing for Session Hijacking
- [ ] WSTG-SESS-10: Testing JSON Web Tokens
- [ ] WSTG-SESS-11: Testing for Session Termination

### WSTG-INPV: Input Validation (29 tests)
- [ ] WSTG-INPV-01: Testing for Reflected Cross Site Scripting
- [ ] WSTG-INPV-02: Testing for Stored Cross Site Scripting
- [ ] WSTG-INPV-03: Testing for HTTP Verb Tampering
- [ ] WSTG-INPV-04: Testing for HTTP Parameter Pollution
- [ ] WSTG-INPV-05: Testing for SQL Injection
- [ ] WSTG-INPV-06: Testing for LDAP Injection
- [ ] WSTG-INPV-07: Testing for XML Injection
- [ ] WSTG-INPV-08: Testing for SSI Injection
- [ ] WSTG-INPV-09: Testing for XPath Injection
- [ ] WSTG-INPV-10: Testing for IMAP SMTP Injection
- [ ] WSTG-INPV-11: Testing for Code Injection
- [ ] WSTG-INPV-12: Testing for Command Injection
- [ ] WSTG-INPV-13: Testing for Format String Injection
- [ ] WSTG-INPV-14: Testing for Incubated Vulnerability
- [ ] WSTG-INPV-15: Testing for HTTP Splitting Smuggling
- [ ] WSTG-INPV-16: Testing for HTTP Incoming Requests
- [ ] WSTG-INPV-17: Testing for Host Header Injection
- [ ] WSTG-INPV-18: Testing for Server-side Template Injection
- [ ] WSTG-INPV-19: Testing for Server-Side Request Forgery
- [ ] WSTG-INPV-20: Testing for Mass Assignment
- [ ] WSTG-INPV-21: Testing for Reflected DOM Based XSS
- [ ] WSTG-INPV-22: Testing for Stored DOM Based XSS
- [ ] WSTG-INPV-23: Testing for DOM Based XSS
- [ ] WSTG-INPV-24: Testing for DOM Clobbering
- [ ] WSTG-INPV-25: Testing for CSS Injection
- [ ] WSTG-INPV-26: Testing for Client-side Resource Manipulation
- [ ] WSTG-INPV-27: Testing for Cross-Origin Resource Sharing
- [ ] WSTG-INPV-28: Testing for Cross-Site Flashing
- [ ] WSTG-INPV-29: Testing for Clickjacking

### WSTG-ERRH: Error Handling (2 tests)
- [ ] WSTG-ERRH-01: Testing for Improper Error Handling
- [ ] WSTG-ERRH-02: Testing for Stack Traces

### WSTG-CRYP: Cryptography (4 tests)
- [ ] WSTG-CRYP-01: Testing for Weak Transport Layer Security
- [ ] WSTG-CRYP-02: Testing for Padding Oracle
- [ ] WSTG-CRYP-03: Testing for Sensitive Information Sent via Unencrypted Channels
- [ ] WSTG-CRYP-04: Testing for Weak Encryption

### WSTG-BUSL: Business Logic (10 tests)
- [ ] WSTG-BUSL-01: Test Business Logic Data Validation
- [ ] WSTG-BUSL-02: Test Ability to Forge Requests
- [ ] WSTG-BUSL-03: Test Integrity Checks
- [ ] WSTG-BUSL-04: Test for Process Timing
- [ ] WSTG-BUSL-05: Test Number of Times a Function Can Be Used Limits
- [ ] WSTG-BUSL-06: Testing for the Circumvention of Work Flows
- [ ] WSTG-BUSL-07: Test Defenses Against Application Misuse
- [ ] WSTG-BUSL-08: Test Upload of Unexpected File Types
- [ ] WSTG-BUSL-09: Test Upload of Malicious Files
- [ ] WSTG-BUSL-10: Test Payment Functionality

### WSTG-CLNT: Client-side Testing (14 tests)
- [ ] WSTG-CLNT-01: Testing for DOM-Based Cross Site Scripting
- [ ] WSTG-CLNT-02: Testing for JavaScript Execution
- [ ] WSTG-CLNT-03: Testing for HTML Injection
- [ ] WSTG-CLNT-04: Testing for Client-side URL Redirect
- [ ] WSTG-CLNT-05: Testing for CSS Injection
- [ ] WSTG-CLNT-06: Testing for Client-side Resource Manipulation
- [ ] WSTG-CLNT-07: Test Cross Origin Resource Sharing
- [ ] WSTG-CLNT-08: Testing for Cross Site Flashing
- [ ] WSTG-CLNT-09: Testing for Clickjacking
- [ ] WSTG-CLNT-10: Testing WebSockets
- [ ] WSTG-CLNT-11: Test Web Messaging
- [ ] WSTG-CLNT-12: Testing Browser Storage
- [ ] WSTG-CLNT-13: Testing for Cross Site Script Inclusion
- [ ] WSTG-CLNT-14: Testing for Reverse Tabnabbing

### WSTG-APIT: API Testing (4 tests)
- [ ] WSTG-APIT-01: Testing GraphQL
- [ ] WSTG-APIT-02: Testing for Improper Assets Management
- [ ] WSTG-APIT-03: Testing for Mass Assignment
- [ ] WSTG-APIT-04: Testing for Injection Flaws in API

---

## Cloud Security Testing

### AWS Security
- [ ] IAM Policy Analysis
- [ ] S3 Bucket Permissions
- [ ] EC2 Security Groups
- [ ] Lambda Function Permissions
- [ ] RDS Public Accessibility
- [ ] CloudTrail Logging
- [ ] KMS Key Policies
- [ ] Secrets Manager Configuration

### Azure Security
- [ ] Azure AD Security
- [ ] Blob Storage Permissions
- [ ] RBAC Configuration
- [ ] Key Vault Access Policies
- [ ] Network Security Groups
- [ ] Activity Log Configuration
- [ ] Conditional Access Policies

### GCP Security
- [ ] IAM Bindings Review
- [ ] GCS Bucket ACLs
- [ ] Compute Instance Service Accounts
- [ ] VPC Firewall Rules
- [ ] Cloud Functions Permissions
- [ ] Audit Logging Configuration

---

## Internal Network Testing

### Network Reconnaissance
- [ ] Port Scanning
- [ ] Service Enumeration
- [ ] Network Mapping
- [ ] SNMP Enumeration

### Active Directory
- [ ] Domain Enumeration
- [ ] User Enumeration
- [ ] Group Enumeration
- [ ] GPO Analysis
- [ ] ACL Abuse Paths
- [ ] Trust Relationships

### Credential Attacks
- [ ] Kerberoasting
- [ ] AS-REP Roasting
- [ ] Password Spraying
- [ ] LLMNR/NBT-NS Poisoning
- [ ] NTLM Relay

### Privilege Escalation
- [ ] Local Admin to Domain Admin Paths
- [ ] Unconstrained Delegation
- [ ] Constrained Delegation
- [ ] AD CS Abuse
- [ ] GPO Abuse

---

## Bug Bounty Methodology

### Asset Discovery
- [ ] Subdomain Enumeration
- [ ] Port Scanning
- [ ] Technology Fingerprinting
- [ ] Content Discovery

### Historical Analysis
- [ ] Wayback Machine
- [ ] GAU URLs
- [ ] Certificate Transparency
- [ ] Historical DNS

### JavaScript Analysis
- [ ] Endpoint Extraction
- [ ] API Key Discovery
- [ ] Secret Detection
- [ ] Hidden Functionality

### Vulnerability Hunting
- [ ] IDOR Testing
- [ ] Authentication Bypass
- [ ] Access Control Issues
- [ ] Business Logic Flaws
- [ ] Rate Limiting Bypass
- [ ] Subdomain Takeover
