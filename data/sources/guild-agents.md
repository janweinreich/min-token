# Guild Agents and Integrations

## Coded agents versus LLM agents

A Guild coded agent runs deterministic code that you author. Given the same
input it takes the same actions every time, because control flow is written in
code rather than decided by a model.

An LLM agent decides its own actions by prompting a model. It is more flexible
but not reproducible: the same input can produce different tool calls on
different runs.

Choose a coded agent when the dispatch logic is known in advance and you want
auditable, repeatable behaviour. Choose an LLM agent when the task is
open-ended.

## Custom integrations

A custom integration exposes an external HTTP API to Guild agents as typed
tools. Guild accepts an OpenAPI 3.0 or 3.1 document, in YAML or JSON, and
generates one tool per operation.

Authentication is configured when the integration is created. The options are an
API key, OAuth 2.0, or OAuth machine-to-machine client credentials.

## Network restrictions

Guild blocks requests to private network ranges, loopback addresses such as
`localhost` and `127.0.0.1`, and internal DNS names. This is deliberate
protection against server-side request forgery.

Local development therefore requires exposing the service through a public HTTPS
tunnel, using a tool such as cloudflared or ngrok, and registering the tunnel URL
as the integration base URL.

## Publishing an integration

The workflow is create, add operations, then build and publish a version:

```bash
guild integration create my-service \
  --base-url https://api.example.com \
  --auth-scheme api-key

guild integration operation create myorg~my-service --openapi ./openapi.yaml
guild integration version build myorg~my-service --version-number 1.0.0
guild integration version publish myorg~my-service --version-number 1.0.0
```

A published version is immutable. Changing the base URL requires publishing a
new version, so a tunnel URL that rotates on restart will invalidate the
integration.
