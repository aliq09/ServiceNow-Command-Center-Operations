# ServiceNow Command Center Operations

Operational dashboard for ServiceNow instance visibility, CMDB/ITSM intelligence, discovery, SAM, governance, developer workflows, and controlled data movement.

## Local development

```bash
npm install
npm run dev
```

The app runs the Vite client on `http://localhost:5177` and the backend API on the companion Node server.

## ServiceNow mode

Open:

```text
/servicenow
```

to load the ServiceNow operations console.

## Notes

- Credentials are handled server-side.
- ServiceNow instance profiles are configured through the local instance registry and environment files.
- The repo is intended for local operations, controlled testing, and ServiceNow workflow experiments.
