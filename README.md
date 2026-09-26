# ServiceNow Command Center Operations

A local operations console for exploring ServiceNow estate health, CMDB and ITSM intelligence, Discovery, SAM, governance, developer workflows, and controlled data movement from one interface.

## Overview

This project brings operational and engineering views together so ServiceNow teams can inspect platform information without constantly switching between separate tools and scripts.

The application combines a React/Vite frontend with a Node/Express backend. ServiceNow credentials and instance interaction remain server-side.

## Capabilities

- ServiceNow instance visibility and operational checks.
- CMDB and ITSM-focused intelligence.
- Discovery and infrastructure views.
- Software Asset Management-oriented analysis.
- Governance and developer workflow experiments.
- Controlled data-movement tooling.
- AI-assisted operational analysis where configured.

## Technology stack

- React 19
- Vite
- Node.js / Express
- OpenAI SDK
- Google GenAI SDK
- Environment-based ServiceNow connection configuration

## Local development

```bash
npm install
npm run dev
```

The development environment starts:

- Vite client: `http://localhost:5177`
- Companion Node API server: started through `npm run dev:server`

Build the frontend with:

```bash
npm run build
```

## ServiceNow operations console

Open:

```text
/servicenow
```

to access the ServiceNow-focused operational experience.

## Configuration and security

- Keep credentials server-side.
- Store local configuration in environment files that are excluded from Git.
- Never commit ServiceNow passwords, tokens, cookies, API keys, or customer data.
- Use non-production instances for experimentation unless a production-safe workflow has been explicitly designed and approved.

## Project status

**Development / operations toolkit.** This repository is designed for controlled engineering use and ongoing experimentation rather than unrestricted production automation.
