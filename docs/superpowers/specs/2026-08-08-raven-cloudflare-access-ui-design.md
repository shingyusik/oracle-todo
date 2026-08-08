# Raven Cloudflare Access UI Design

## Goal

Allow an Access-authenticated browser to open `https://raven.b-sir.xyz` directly and receive
a Raven UI session automatically. Preserve the current loopback-only development behavior and
keep Raven's session authentication on every API route.

## Security Boundary

Cloudflare Access is the public identity boundary. `cloudflared` must independently validate
the Access JWT for the Raven ingress with `originRequest.access.required`, the exact team name,
and the Raven application's audience tag. Raven does not implement JWT cryptography or trust an
unvalidated forwarded identity header.

The existing random per-process Raven session remains the API credential. Public requests must
still pass Raven's exact authority/origin policy, and public session cookies use `Secure`,
`HttpOnly`, `SameSite=Strict`, and `Path=/` without a `Domain` attribute.

## Configuration

- `raven ui` remains bound to `127.0.0.1` only.
- Optional `RAVEN_UI_PUBLIC_ORIGIN` enables the Cloudflare Access UI mode.
- The value must be one absolute `https://` origin with a hostname and optional port.
- Credentials, paths other than `/`, queries, fragments, malformed values, and non-HTTPS
  schemes fail startup with a safe configuration error.
- Without `RAVEN_UI_PUBLIC_ORIGIN`, behavior is unchanged.

For this deployment:

```text
RAVEN_UI_PUBLIC_ORIGIN=https://raven.b-sir.xyz
```

## Request Policy

Raven accepts two exact request pairs when public mode is configured:

1. The existing loopback Host and matching `http://` Origin.
2. The configured public Host and matching `https://` Origin.

Missing, duplicate, malformed, unknown, or mixed Host/Origin values return `421 Misdirected
Request`. A top-level navigation may omit `Origin`, but its Host must still match one configured
pair.

Every request using the public Host must contain exactly one non-empty
`Cf-Access-Jwt-Assertion` header. Raven treats its presence as evidence from the trusted local
`cloudflared` process; `cloudflared`, not Raven, validates its signature and audience. Requests
using the loopback Host neither require nor consume this header.

## Session Flow

For a public `GET` that successfully serves the UI HTML entry point or an extensionless SPA
fallback, Raven adds the current session cookie to the response. This refreshes stale browser
sessions after a Raven restart and supports direct navigation to UI routes. Static assets do not
issue sessions.

The browser then sends the Raven cookie on same-origin `/api/v1/*` requests. API authentication
continues to use the existing Raven session verifier. The explicit `/__raven/session` bootstrap
route remains available for local mode and keeps its current redirect behavior.

Local startup remains unchanged: `raven ui` opens the loopback bootstrap route unless
`--no-open` is used. A local developer using `--no-open` can open `/__raven/session` manually.

## Tunnel Deployment

The existing `paperclip` tunnel routes `raven.b-sir.xyz` directly to
`http://127.0.0.1:3001`. Its Raven ingress must:

- enable Access JWT validation with `access.required`, `teamName`, and the Raven `audTag`;
- preserve the public Host instead of setting `httpHostHeader` to loopback;
- forward the original HTTPS Origin instead of relying on a Cloudflare Origin rewrite rule.

Cloudflare Access must protect every path on `raven.b-sir.xyz`. No public listener or inbound
firewall port is added.

## Error Handling

- Invalid public-origin configuration aborts before listening and does not echo the supplied
  value.
- Public requests without the Access assertion, or with duplicate assertions, receive `421`
  without a session cookie.
- Invalid authority/origin combinations receive `421` without a session cookie.
- API requests without a valid Raven cookie continue to receive `401`.
- Logs never contain Access assertions or Raven session values.

## Tests

Automated tests cover:

- unchanged local bootstrap and API round trip;
- strict public-origin parsing;
- exact local/public Host and Origin pairing;
- required single Access assertion on every public request;
- automatic `Secure` session issuance on public HTML responses;
- no automatic session on public static assets or rejected requests;
- stale-session replacement through a new public HTML response;
- successful public cookie use on the existing API;
- safe CLI startup errors for malformed and non-Unicode configuration.

Deployment verification uses a temporary Raven home for mutation checks, confirms Access blocks
anonymous traffic, and verifies the live Dashboard read without modifying the live databases.

## Non-goals

- Removing Raven's API session authentication.
- Validating Cloudflare JWT signatures inside Raven.
- Supporting arbitrary reverse proxies or multiple public origins.
- Binding Raven to a non-loopback address.
- Changing database schemas, migrations, or domain behavior.
