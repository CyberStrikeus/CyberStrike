---
name: cis-cassandra41-1.3
description: "Ensure the latest version of Python is installed"
category: cis-cassandra
version: "1.0.0"
author: cyberstrike-official
tags: [cis, cassandra, installation, python, updates]
cis_id: "1.3"
cis_benchmark: "CIS Apache Cassandra 4.1 Benchmark v1.0.0"
tech_stack: [cassandra, python]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.3 Ensure the latest version of Python is installed

## Profile Applicability
- Level 1 - Cassandra on Linux

## Description
A prerequisite to installing Cassandra is the installation of Python. The version of Python installed should be the most recent that is compatible with the organizations' operational needs.

## Rationale
Using the most recent Python can help limit the possibilities for vulnerabilities in the software, the installation version applied during setup should be established according to the needs of the organization. Ensure you are using a release that is covered by a level of support which includes regular updates to address vulnerabilities.

## Audit
To verify that you have the correct version of python installed:

```bash
# python -V
or
# python --version
```

If an old/unsupported version of Python is installed this is a finding.
For using cqlsh, the latest version of Python 3.6+ or Python 2.7 (support deprecated) is required.

## Remediation
1. Uninstall the old/unsupported version of Python, if present.
2. Download the latest compatible release of the Python:
   https://www.python.org/downloads/
3. Follow the provided installation instructions to complete the install.

## Default Value
Python may be pre-installed on some Linux distributions.

## References
1. https://www.python.org/downloads/
2. http://cassandra.apache.org/doc/latest/getting_started/installing.html#prerequisites

## CIS Controls
**v8:**
- 16.5 Use Up-to-Date and Trusted Third-Party Software Components
  - Use up-to-date and trusted third-party software components. When possible, choose established and proven frameworks and libraries that provide adequate security. Acquire these components from trusted sources or evaluate the software for vulnerabilities before use.

**v7:**
- 18.4 Only Use Up-to-date And Trusted Third-Party Components
  - Only use up-to-date and trusted third-party components for the software developed by the organization.

## Profile
- Level 1 | Automated
