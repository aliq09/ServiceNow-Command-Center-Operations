# ServiceNow MCP

This directory contains a repo-local launcher for `mcp-server-servicenow`.
It exposes ServiceNow table, CMDB, system, and update-set tools over MCP
stdio without putting credentials in the MCP client configuration.

## Install

```powershell
python -m pip install -r .\mcp\requirements.txt
Copy-Item .env.servicenow.example .env.servicenow
```

Instance profiles are declared in `servicenow-instances.json`.

- PDI credentials: `.env.servicenow`
- Work credentials: `.env.servicenow.work`

Copy `.env.servicenow.work.example` to `.env.servicenow.work`, complete the
private values, then merge both entries from `mcp/servicenow.mcp.json` into
the MCP client's `mcpServers` object and restart the client.

## Run directly

```powershell
python .\mcp\servicenow_server.py --profile pdi
python .\mcp\servicenow_server.py --profile work
```

The process uses stdio, so waiting silently after startup is normal. MCP
clients send JSON-RPC requests over stdin.

## TLS

`SERVICENOW_TLS_VERIFY=true` is the secure default. Set it to `false` only
for a development PDI with a certificate-chain problem. The workaround is
limited to the ServiceNow MCP process.
