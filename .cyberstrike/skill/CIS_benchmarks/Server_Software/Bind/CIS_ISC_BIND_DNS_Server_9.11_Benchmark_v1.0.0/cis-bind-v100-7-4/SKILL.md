---
name: cis-bind-v100-7-4
description: "Ensure Either SPF or DKIM DNS Records are Configured (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, secure-network]
cis_id: "7.4"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 7.4 — Ensure Either SPF or DKIM DNS Records are Configured

## Profile Applicability

- Authoritative Name Server Level 2

## Description

For each authoritative domain that receives SMTP email, add either an SPF (Sender Policy Framework) TXT record and/or add a DKIM (DomainKeys Identified Mail) TXT record.

## Rationale

The SPF record reduces spam and phishing usage of a domain name, by publishing the IP addresses of the authorized mail servers, allowed to send mail for the domain. SPF compliant mail servers may reject or treat as SPAM, any mail coming from other IP addresses.

The DKIM record publishes a public key which may be used to verify the authenticity and integrity of the message by using the key to verify a digital signature of the message stored in an SMTP header.

Either or both of the technologies is recommended to be configured for each domain, to reduced spoofing and phishing attacks that use the domains in a FROM address. Consider the risk of a spoofed phishing email coming from upper management with an urgent request which had a valid FROM address. It might be too easy for someone to trust the email and take the action requested. In addition to SPF and DKIM, configuring a DMARC record, after SPF and/or DKIM records are in place, is helpful for reporting and forensics on attempted usage of the domain name. Only the SPF and DKIM DNS records are audited in this recommendation.

## Impact

Not specified in the PDF.

## Audit Procedure

For each authoritative domain, perform the following:

- Check the domain for an MX record to verify that the domain receives SMTP email. If there no MX record, then the domain is considered compliant. The following host command will query the localhost DNS server for any MX records for the given domain. The output below shows a domain that does not have an MX record.

```
$ host -t mx example1.com 127.0.0.1
. . .
example1.com has no MX record
```

For domains which have an MX record, perform the following two tests to audit compliance. If either test passes, the domain is considered compliant.

- Query the DNS server, to check that an SPF TXT record is present and has either a strict (`-all`) or soft fail (`~all`) policy at the end of the record. The following command queries the `ns1.example.net` name server for an SPF record for the example.com domain.

```
$ host -t txt example.com ns1.example.org | grep 'v=spf1.*[~-]all'
example.com descriptive text "v=spf1 a mx a:mail.example.net
ip4:10.1.2.3 ~all"
```

If there is no output, then either an SPF record does not exist, or it does not have the recommended policy.

- Query the DNS server to check for a default DKIM TXT record with a public key. The following command queries the `ns1.example.net` name server for an SPF record for the example.com domain.

```
$ host -t txt default._domainkey.example.com ns1.example.org | grep 'v=DKIM1; k=rsa; p='
default._domainkey.example.com descriptive text "v=DKIM1; k=rsa;
p=MIGf. . . "
```

If there is no output, then a default DKIM record does not exist.

## Remediation

Add either an SPF TXT record and/or a default DKIM TXT record to the domains with the appropriate values. The SPF record should have a soft fail policy of `~all` or a strict policy of `-all`. There are on-line resources and tools such as MX toolbox that will help in generating and testing SPF, DKIM and DMARC records as shown in the references.

## Default Value

No SPF or DKIM records are configured by default.

## References

1. https://mxtoolbox.com/NetworkTools.aspx
2. https://mxtoolbox.com/spf.aspx
3. https://mxtoolbox.com/dkim.aspx

## CIS Controls

| Controls Version | Control                             | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------- | ---- | ---- | ---- |
| v6               | 7 Email and Web Browser Protections | Y    | Y    | Y    |
| v7               | 7 Email and Web Browser Protections | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic          | Technique                            |
| --------------- | ------------------------------------ |
| Initial Access  | T1566 - Phishing                     |
| Initial Access  | T1566.001 - Spearphishing Attachment |
| Defense Evasion | T1036 - Masquerading                 |

## Profile

- Level 2 - Authoritative Name Server
