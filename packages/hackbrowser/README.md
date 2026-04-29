# CyberStrike Browser Agent

AI-driven browser agent that automatically navigates web applications, captures HTTP requests with UI context, and sends them to CyberStrike for security analysis.

## How It Works

```
Playwright browser
    ├── AI navigation (Claude → accessibility tree → actions)
    ├── Request capture (all HTTP traffic to target)
    ├── UI context snapshot (form fields, readonly/disabled/hidden states)
    └── → POST /session/ingest to CyberStrike (with ui_context field)
```

The key addition over the Firefox extension: every captured request is enriched with `ui_context` — a snapshot of the page's form fields at the time the request was made. This tells CyberStrike:

- Which fields were `readonly` or `disabled` in the UI (but still sent in the request)
- Which values were display-only (`span`/`div`, not `input`) but appear in the request body
- Which request parameters have no corresponding UI element (hidden params)
- Client-side validation constraints (min, max, pattern) that might not be enforced server-side

## Setup

```bash
cd hackbrowser
bun install
npx playwright install chromium
```

Set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

## Usage

```bash
# Basic — visit target, AI navigates everything
bun start https://app.example.com

# With saved session (skip login)
bun start https://app.example.com --session ./session.json

# Auto-login
bun start https://app.example.com --user admin@example.com --pass secret

# Attach to existing CyberStrike session
bun start https://app.example.com --session-id abc123

# Headless, more steps
bun start https://app.example.com --headless --steps 100
```

## Auth Scenarios

| Scenario                     | How                                                       |
| ---------------------------- | --------------------------------------------------------- |
| Session file (pre-logged in) | `--session ./session.json`                                |
| Auto username/password       | `--user x --pass y`                                       |
| 2FA / MFA                    | Agent pauses and waits for user to enter code in terminal |
| SSO / OAuth                  | Log in manually first, save session, use `--session`      |
| Multiple roles               | Run multiple times with different session files           |

## Project Structure

```
src/
├── index.ts      # CLI entry point
├── agent.ts      # Main loop: navigation + request pipeline
├── navigator.ts  # LLM-guided navigation (accessibility tree → Claude → action)
├── capture.ts    # UI context snapshot + request builder
├── ingest.ts     # Send to CyberStrike /session/ingest
├── auth.ts       # Session load/save, auto-login, 2FA pause
└── types.ts      # Shared types
```

## ui_context Payload

Each ingested request includes a `ui_context` field:

```json
{
  "text": "POST /api/users/42 HTTP/1.1\r\n...",
  "sessionID": "abc123",
  "response": { "status": 200, "headers": {}, "body": "..." },
  "ui_context": {
    "pageUrl": "https://app.example.com/settings/profile",
    "pageTitle": "Edit Profile",
    "componentPath": "Settings > Profile",
    "formName": "Update Profile",
    "fields": [
      { "name": "email", "value": "john@example.com", "type": "text", "isReadOnly": true, ... },
      { "name": "username", "value": "john", "type": "text", "isReadOnly": false, ... },
      { "name": "role", "value": "user", "type": "hidden", "isHidden": true, ... }
    ],
    "hiddenParams": ["account_id", "_csrf"]
  }
}
```

CyberStrike's proxy-analyzer and mass-assignment agents will use this to identify:

- `email` is readonly in UI but sent in request → test if it can be changed
- `role` is a hidden field → test mass assignment
- `account_id` not in UI at all → high-risk hidden parameter
