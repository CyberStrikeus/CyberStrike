---
marp: true
theme: default
paginate: true
backgroundColor: #0a0a0a
color: #e0e0e0
style: |
  section {
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
  }
  h1, h2, h3 {
    color: #00ff88;
  }
  code {
    background: #1a1a2e;
    color: #00ff88;
  }
  a {
    color: #00d4ff;
  }
  table {
    font-size: 0.85em;
  }
  th {
    background: #1a1a2e;
    color: #00ff88;
  }
  td {
    background: #0d0d0d;
  }
---

# MCP Integration

## Model Context Protocol for Extensible Tools

<!-- TODO: Logo placeholder - replace with actual logo -->
<!-- ![bg right:40% 80%](../images/cyberstrike-logo.svg) -->
![bg right:40% 80%](#00ff88)

**Extending Cyberstrike with External Tools**

---

# What is MCP?

## Model Context Protocol

A standardized protocol for AI agents to interact with external tools and services.

### Core Components
- **Tools**: Executable functions
- **Resources**: Data sources
- **Prompts**: Reusable templates

---

# MCP Architecture

```
┌─────────────────────────────────────────────────┐
│                  Cyberstrike                    │
│  ┌──────────┐              ┌───────────────┐   │
│  │ AI Agent │◄────────────►│  MCP Client   │   │
│  └──────────┘              └───────┬───────┘   │
└────────────────────────────────────┼───────────┘
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         │                           │                           │
         ▼                           ▼                           ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Local Server   │     │  Remote Server  │     │  Kali Server    │
│  (filesystem)   │     │  (enterprise)   │     │  (security)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

---

# Server Types

## Local vs Remote

| Type | Transport | Use Case |
|------|-----------|----------|
| **Local** | stdio | Security tools, file access |
| **Remote** | HTTP/HTTPS | Cloud services, team tools |

---

# Local Server Configuration

## Running on Your Machine

```json
{
  "mcp": {
    "filesystem": {
      "type": "local",
      "command": [
        "npx",
        "@modelcontextprotocol/server-filesystem",
        "/path/to/dir"
      ],
      "enabled": true,
      "timeout": 30000
    }
  }
}
```

---

# Remote Server Configuration

## Connecting to External Services

```json
{
  "mcp": {
    "security-api": {
      "type": "remote",
      "url": "https://api.security-tools.example.com/mcp",
      "headers": {
        "X-API-Key": "{env:SECURITY_API_KEY}"
      },
      "enabled": true,
      "timeout": 60000
    }
  }
}
```

---

# Environment Variables

## Secure Credential Management

```json
{
  "mcp": {
    "enterprise": {
      "type": "remote",
      "url": "https://tools.corp.com/mcp",
      "headers": {
        "Authorization": "Bearer {env:CORP_TOKEN}"
      }
    }
  }
}
```

Use `{env:VAR_NAME}` for sensitive values

---

# OAuth Authentication

## Automatic Token Management

```json
{
  "mcp": {
    "enterprise-tools": {
      "type": "remote",
      "url": "https://tools.enterprise.com/mcp",
      "oauth": {
        "clientId": "cyberstrike-client",
        "clientSecret": "{env:OAUTH_SECRET}",
        "scope": "tools:read tools:execute"
      }
    }
  }
}
```

---

# OAuth Commands

## Managing Authentication

```bash
# Authenticate with a server
cyberstrike mcp auth security-api

# List OAuth status
cyberstrike mcp auth list

# Remove credentials
cyberstrike mcp logout security-api

# Debug OAuth issues
cyberstrike mcp debug security-api
```

---

# Managing Servers

## Server Lifecycle

```bash
# List all servers
cyberstrike mcp list

# Add new server
cyberstrike mcp add

# Toggle in TUI
/mcps
```

---

# Server Status

## Status Icons

```
MCP Servers

✓ kali            connected
    npx @cyberstrike/mcp-kali

✓ security-api    connected (OAuth)
    https://api.security-tools.example.com/mcp

○ disabled-server disabled
    npx some-server

✗ failing-server  failed
    Connection refused
```

---

# Dynamic Tool Loading

## Managing Context Window

```
┌─────────────────────────────────────────┐
│  Tool Search                            │
│  ┌─────────────────────────────────┐   │
│  │ Query: "sql injection"          │   │
│  └─────────────────────────────────┘   │
│                                         │
│  Results:                               │
│  1. sqlmap_scan (~500 tokens)          │
│  2. nuclei_sqli (~300 tokens)          │
│  3. manual_sqli (~200 tokens)          │
│                                         │
│  [Load Selected]                        │
└─────────────────────────────────────────┘
```

---

# Tool Discovery

## Finding the Right Tool

```json
// Search for tools
{
  "query": "port scanner",
  "limit": 5
}

// Results
{
  "tools": [
    {
      "id": "kali_nmap",
      "description": "Network scanning with Nmap",
      "tokens": 450
    }
  ]
}
```

---

# Loading Tools

## Activating Tools for Use

```json
// Load specific tools
{
  "tool_ids": ["kali_nmap", "kali_nikto"]
}

// Check loaded tools
{
  "available": 150,
  "loaded": 12,
  "estimatedTokens": 4500,
  "budgetRemaining": 15500
}
```

---

# Tool Naming Convention

## Server Prefix Pattern

| Server | Tool | Full Name |
|--------|------|-----------|
| `kali` | `nmap` | `kali_nmap` |
| `security` | `scan` | `security_scan` |
| `custom` | `exploit` | `custom_exploit` |

---

# Built-in: mcp-kali

## Kali Linux Security Tools

```json
{
  "mcp": {
    "kali": {
      "type": "local",
      "command": ["npx", "@cyberstrike/mcp-kali"]
    }
  }
}
```

---

# mcp-kali Tools

| Tool | Description |
|------|-------------|
| `nmap` | Network scanning |
| `nikto` | Web server scanning |
| `sqlmap` | SQL injection testing |
| `gobuster` | Directory enumeration |
| `ffuf` | Web fuzzing |
| `nuclei` | Vulnerability scanning |
| `hydra` | Password cracking |
| `wpscan` | WordPress scanning |

---

# Creating Custom Servers

## Server Structure

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server({
  name: "my-security-tools",
  version: "1.0.0",
}, {
  capabilities: {
    tools: {},
    resources: {},
  },
});
```

---

# Defining Tools

## Tool Registration

```typescript
server.setRequestHandler("tools/list", async () => ({
  tools: [
    {
      name: "scan_target",
      description: "Scan a target for vulnerabilities",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string" },
          depth: { type: "number" },
        },
        required: ["target"],
      },
    },
  ],
}));
```

---

# Handling Tool Calls

## Tool Execution

```typescript
server.setRequestHandler("tools/call", async (request) => {
  if (request.params.name === "scan_target") {
    const { target, depth } = request.params.arguments;

    const result = await performScan(target, depth);

    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }],
    };
  }
});
```

---

# Starting the Server

## Transport Setup

```typescript
// Start with stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
```

---

# Publishing Your Server

## npm Distribution

```bash
# Package and publish
npm publish

# Users configure it
{
  "mcp": {
    "my-tools": {
      "type": "local",
      "command": ["npx", "my-security-tools"]
    }
  }
}
```

---

# MCP Resources

## Data Context for AI

```
@security-api://reports/latest

Analyze this vulnerability report
```

Resources provide structured data to the agent

---

# Security Testing Setup

## Complete Configuration

```json
{
  "mcp": {
    "kali": {
      "type": "local",
      "command": ["npx", "@cyberstrike/mcp-kali"],
      "timeout": 120000
    },
    "nuclei": {
      "type": "local",
      "command": ["npx", "@cyberstrike/mcp-nuclei"],
      "environment": {
        "NUCLEI_TEMPLATES": "/path/to/templates"
      }
    },
    "burp": {
      "type": "remote",
      "url": "http://localhost:8080/mcp",
      "oauth": false
    }
  }
}
```

---

# Enterprise Setup

## Corporate Integration

```json
{
  "mcp": {
    "enterprise-scanner": {
      "type": "remote",
      "url": "https://scanner.corp.example.com/mcp",
      "oauth": {
        "clientId": "cyberstrike-client",
        "scope": "scan:read scan:write"
      },
      "timeout": 300000
    },
    "siem-integration": {
      "type": "remote",
      "url": "https://siem.corp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer {env:SIEM_TOKEN}"
      }
    }
  }
}
```

---

# Configuration Locations

## Priority Order

| Location | Scope | Priority |
|----------|-------|----------|
| `./cyberstrike.json` | Project | Highest |
| `~/.config/cyberstrike/cyberstrike.json` | Project | High |
| `~/.cyberstrike/config.json` | Global | Low |

---

# Troubleshooting

## Common Issues

### Server Not Connecting
```bash
# Check status
cyberstrike mcp list

# Verify command
npx @modelcontextprotocol/server-filesystem --help
```

### OAuth Issues
```bash
# Debug flow
cyberstrike mcp debug server-name

# Re-authenticate
cyberstrike mcp auth server-name
```

---

# Security Considerations

## Best Practices

### Local Servers
- Run with minimum permissions
- Validate all inputs
- Sandbox dangerous operations

### Remote Servers
- Use HTTPS only
- Rotate OAuth credentials
- Verify server certificates

---

# Credential Storage

## Secure Token Management

```
~/.local/share/cyberstrike/mcp-auth.json
```

OAuth tokens stored securely with:
- Encryption at rest
- Automatic token refresh
- Secure deletion on logout

---

# Best Practices

## MCP Integration Tips

1. **Start with built-in servers** (mcp-kali)
2. **Use environment variables** for secrets
3. **Set appropriate timeouts** for long operations
4. **Monitor token budget** to avoid context overflow
5. **Unload unused tools** to free context
6. **Create custom servers** for specialized needs

---

# Summary

## MCP Capabilities

| Feature | Benefit |
|---------|---------|
| Local Servers | Run security tools locally |
| Remote Servers | Connect to team services |
| OAuth | Secure authentication |
| Dynamic Loading | Efficient context usage |
| Custom Servers | Extend with your tools |

---

# Resources

## Learn More

- **MCP Docs**: https://cyberstrike.io/docs/mcp
- **MCP SDK**: https://github.com/modelcontextprotocol/sdk
- **mcp-kali**: https://github.com/CyberStrikeus/mcp-kali

---

# Thank You

## Extend Cyberstrike with MCP

```bash
cyberstrike mcp add
```

**Questions?**

---
