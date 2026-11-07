# Disclaimer

## Responsible use

REA is built for lawful analysis: security research, malware and incident
analysis, vulnerability research and coordinated disclosure, CTFs and education,
interoperability, software preservation, and debugging or auditing software you
own or are authorized to examine.

The REA project does not support, and will not help with:

- circumventing DRM, license checks, anti-cheat systems or other technical
  protection measures;
- developing game cheats or tampering with online services;
- bypassing authentication, bot protection or access controls on systems you are
  not authorized to test;
- copying proprietary software or reproducing its protected code and assets;
- evading the usage policies or safety measures of AI model providers;
- reselling or sharing AI accounts or API access.

You are responsible for obtaining any required authorization and for complying
with applicable laws, license agreements and terms of service. Reverse
engineering may be restricted in your jurisdiction or by the license of the
software you analyze.

Requests for help with the uses above will be closed without response in issues
and discussions, and may result in removal from the REA community.

## User responsibility

Do not use REA for unauthorized access or exploitation, credential theft,
malicious deployment of malware, unlawful collection or disclosure of data,
unauthorized service disruption, or unlawful circumvention of access controls or
licensing restrictions. Legitimate security research and malware analysis must
remain within the rights and permissions applicable to the work.

You are responsible for your use of REA, including commands, configurations,
scripts, and actions you direct an AI agent to perform. Establish the legal
authority and scope required for the targets, accounts, devices, software, data,
and operations involved. Comply with applicable laws, contracts,
intellectual-property rights, privacy obligations, and tool licenses. Public
availability of software, possession of a file, or access to a debugging
endpoint does not by itself establish permission for every operation.

## Runtime, network, and device operations

Some REA workflows execute or observe programs, attach to runtime or browser
endpoints, capture network traffic, interact with applications, or operate on
connected devices. These actions can affect application state, files, accounts,
devices, and services. Authorization to inspect an artifact does not necessarily
authorize execution, interception, device changes, or interaction with another
party's system.

Review the operations you request, including agent-generated plans and scripts,
and use an appropriate environment for untrusted targets. You are responsible
for protecting credentials, personal data, captured traffic, and investigation
artifacts, and for obtaining any permission required to collect, retain,
process, or share them. Local operation does not establish authorization or
guarantee that executed targets and third-party tools have no external effects.

## Analysis results and generated output

Decompilation, reconstruction, heuristics, and AI-assisted analysis may be
incomplete or incorrect. Results do not guarantee accuracy, completeness,
security, compatibility, or legal compliance. Review the underlying evidence and
verify consequential conclusions before relying on them.

Obtaining source-like output or an analysis report does not grant rights to the
original program, its data, or the generated output. Check the target's rights
and the producing tool's applicable terms before publishing, sharing, or using
results in another product or service.

## Third-party tools and licenses

Third-party components and analysis tools retain their own licenses, copyright
notices, and usage conditions. Consult
[Third-party notices](THIRD_PARTY_NOTICES.md) for their roles, licensing
records, and preserved upstream texts.

You must legally obtain IDA Pro and Hex-Rays decompilers, Hopper, JEB, and any
other proprietary tools, together with the rights required for your use. REA
provides no commercial-tool license, key, or activation entitlement. Permitted
trials and demos remain subject to vendor terms. An open-source bridge or
accessible API does not grant additional user, machine, feature, automation,
hosting, or output-sharing rights. Cracked copies, stolen keys, unauthorized key
sharing, and bypassing license restrictions are not authorized by REA.

## Disclaimer of warranty

REA is provided **AS IS**, without express or implied warranties, including
merchantability, fitness for a particular purpose, and noninfringement, as set
out in the [MIT License](LICENSE). You assume the risks of using the software
and deciding whether it is suitable for your task. No project description,
example, analysis result, or third-party integration guarantees a particular
outcome or establishes that your intended use is lawful or safe.

## Limitation of liability

The warranty and liability provisions of the [MIT License](LICENSE) govern REA's
authors and copyright holders, subject to applicable law. That license disclaims
liability for claims, damages, and other liability arising from or in connection
with the software or its use, whether in contract, tort, or otherwise. This
document does not expand those provisions or override rights and obligations
that cannot be excluded under applicable law.

## Disclaimer of endorsement

References to third-party projects, contributors, products, services, and
trademarks identify their work and REA's integrations. Credits and thanks do not
imply affiliation, sponsorship, approval, or endorsement by the named parties,
including the National Security Agency and commercial tool vendors.
Redistribution, bundling, or hosting by a third party does not by itself imply
affiliation with or endorsement by the REA project.

## Relationship to software licenses

This document explains REA's intended use, user responsibilities, and community
support boundaries. It does not amend the MIT license, impose additional
copyright-license conditions, replace upstream licenses, or grant rights to
third-party software or targets. The applicable software licenses and agreements
retain their own terms.

## Versions, distribution channels, and platforms

The project's position on lawful use and non-endorsement of illegal or
unauthorized activity covers all REA versions, distribution forms, and
platforms. This includes historical releases and Git commits, npm packages,
bundled or separately distributed REA skills, source checkouts, release
archives, and redistributed copies, regardless of installation method, agent
client, operating system, or platform. Using an older version or another
distribution channel does not imply project endorsement or remove obligations
under applicable law or to respect third-party rights.

Each copy remains subject to the licenses accompanying that copy. This statement
does not retroactively amend existing license grants, add license conditions, or
expand historical warranty or liability exclusions.
