---
name: cis-cassandra311-1.3
description: "Ensure the latest version of Python is installed"
category: cis-cassandra
version: "1.1.0"
author: cyberstrike-official
tags: [cis, cassandra, installation, python, updates]
cis_id: "1.3"
cis_benchmark: "CIS Apache Cassandra 3.11 Benchmark v1.1.0"
tech_stack: [cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.3 Ensure the latest version of Python is installed

## Profile Applicability
- Level 1 - Cassandra on Linux
- Level 2 - Cassandra on Linux

## Description
A prerequisite to installing Cassandra is the installation of Python. The version of Python installed should be the most recent that is compatible with the organizations' operational needs.

## Rationale
Using the most recent Python can help limit the possibilities for vulnerabilities in the software, the installation version applied during setup should be established according to the needs of the organization. Ensure you are using a release that is covered by a level of support which includes regular updates to address vulnerabilities.

## Audit
To verify that you have the correct version of python installed:

```bash
# python -V
```

If an old/unsupported version of Python is installed this is a finding.

## Remediation
1. Uninstall the old/unsupported version of Python, if present.
2. Download the latest compatible release of the Python: https://www.python.org/downloads/
3. Follow the provided installation instructions to complete the install.

## Default Value
No default Python installation exists.

## References
1. https://www.python.org/downloads/
2. http://cassandra.apache.org/doc/latest/getting_started/installing.html#prerequisite s

## CIS Controls
- v8: 16.5 Use Up-to-Date and Trusted Third-Party Software Components
- v7: 18.4 Only Use Up-to-date And Trusted Third-Party Components

## Profile
- Level 1 | Automated
