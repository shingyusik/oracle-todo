# Raven Public UI Origin Design

## Goal

Allow the loopback-only `raven ui` server to accept one explicitly configured HTTPS origin,
so `https://raven.b-sir.xyz` can be served through the existing Cloudflare Tunnel and protected
by the existing Cloudflare Access email policy.

## Configuration

- Add optional `RAVEN_UI_PUBLIC_ORIGIN` for `raven ui`.
- Accept only an absolute `https://` origin with a hostname and optional port.
- Reject credentials, paths other than `/`, queries, fragments, malformed URLs, and non-HTTPS
  values before the listener starts.
- Keep the listener on `127.0.0.1`; this setting never enables a public bind.

For this deployment:

```text
RAVEN_UI_PUBLIC_ORIGIN=https://raven.b-sir.xyz
```

## Request Validation

The UI middleware accepts exactly two authority/origin pairs:

1. The existing loopback authority and its `http://` origin.
2. The configured public authority and its exact `https://` origin.

The request `Host` must identify one pair. When `Origin` is present, it must match that same
pair. Duplicate, malformed, mixed-pair, and all other values return `421 Misdirected Request`.
Requests without `Origin`, such as top-level navigation, remain valid only when `Host` matches
one of the two allowed authorities.

## Session Security

The existing random per-process session token and `HttpOnly; SameSite=Strict; Path=/` cookie
remain unchanged. The public bootstrap response additionally sets `Secure`; the loopback HTTP
bootstrap does not, so local use continues to work.

Cloudflare Access remains the public authentication boundary. Its existing email allow policy
will move from `oracle.b-sir.xyz` to `raven.b-sir.xyz`. Raven does not trust arbitrary forwarded
identity headers and does not disable its own session authentication.

## Tunnel Deployment

Reuse the existing `paperclip` tunnel. Route `raven.b-sir.xyz` directly to
`http://127.0.0.1:3001` without rewriting `Host`. Remove the old `oracle.b-sir.xyz` ingress and
DNS route only after Raven passes local and Access-protected public verification.

## Error Handling and Tests

- Invalid `RAVEN_UI_PUBLIC_ORIGIN` fails startup with a safe configuration error that does not
  include secrets.
- Unit/integration tests cover local compatibility, the configured public pair, mixed pairs,
  duplicate headers, invalid configuration, and conditional `Secure` cookies.
- Deployment verification checks Raven health, migrated ToDo counts, an Access challenge before
  login, and successful UI/API reads after email authentication.

## Non-goals

- Multiple public origins.
- Non-HTTPS public origins.
- A new tunnel, reverse proxy, or Cloudflare header-transform rule.
- Replacing Cloudflare Access with authentication implemented inside Raven.
