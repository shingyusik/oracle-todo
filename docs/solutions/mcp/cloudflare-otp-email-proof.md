# Raven MCP connection: OAuth claims, origin Service Auth and request metadata

Date: 2026-10-15. Applies to the separately deployed `raven-mcp-gateway` Worker.
This gateway is outside the Rust workspace.

## Symptoms and reproduction

Connecting Raven from ChatGPT returns:

```text
Raven authorization could not be completed [RAVEN-AUTH-04] [RAVEN-AUTH-04-EMAIL-VERIFIED-MISSING]
```

A signed upstream OIDC ID token without `email_verified` reproduces the same
classification in the gateway's strict verifier. This error does not establish
that the user's email is unverified; the required claim is missing.

## Confirmed cause

`gateway/src/upstream.js::verifyIdentityToken` requires `email_verified` in
addition to the signature, issuer, audience, subject, timestamps, nonce, and email.
The active version was `3163ce22-876a-4066-9982-24fed98fb9fb`, which retained strict
authentication after a separate downstream token-exchange failure was investigated.
The OTP-compatible candidate existed but was not serving traffic.

This concerns the gateway's upstream OIDC identity exchange. The Rust MCP adapter's
Cloudflare Access JWT verification is a different boundary and does not produce
this error code.

## Resolution and boundaries

The existing reviewed candidate `9ffd1c68-46fa-44ec-b76e-0449567269fb` was promoted
to 100% production traffic after explicit deployment approval. Its downloaded
source matched the previously reviewed SHA-256:

```text
7bc4e477da898e9283b212e8492a2f8d94d91f172966df95f7a51032920f770d
```

The candidate uses the existing `cloudflare-otp-policy-v1` identity proof. A missing
claim is accepted only with the pinned server policy contract. Live read-only
checks confirmed the linked application, policy IDs, selected provider, owner-only
email inclusion, and required One-time PIN match that contract. The sole provider's
actual type is `onetimepin`; automatic IdP redirection is disabled.

The gateway does not manufacture `email_verified=true`. An explicitly false or
nonboolean claim remains rejected. Signature, issuer, audience, expiry, nonce,
owner, and policy-contract checks remain enforced. Resource authorization checks
the stored proof against the configured policy fingerprint.

Existing bindings, runtime settings, exported handlers, and migration tag were
preserved. The existing temporary diagnostic lease was already expired. No Access
policy, credentials, or OAuth scopes were changed.

## Verification and prevention

- The isolated signed-token reproduction used the recovered gateway modules and
  the same `jose` version, `6.2.12`, with synthetic RS256 keys and intercepted HTTP.
- Before applying the historical OTP patch, the OTP acceptance regression failed;
  a separate assertion reproduced the exact missing-claim classification.
- `node --test test/email-proof.test.mjs`: 7 passed after applying the existing
  patch. Cases cover strict mode, explicit verified identity, false/malformed
  claims, signature, owner, nonce, issuer, audience, expiry, and policy mismatch.
- `node --check candidate-worker.js`: passed for the downloaded candidate bundle.
- `git diff --check`: passed for the isolated reproduction.
- Cloudflare reported successful promotion; deployment API readback returned the
  exact candidate version with `percentage: 100`.

## Follow-up: navigation failure

The next user attempt reported `Raven navigation unavailable`. The deployed
`gateway/src/navigation.js::continueNavigation` returns this fixed message for
any rejected navigation handle, binding cookie, stored ciphertext, expiry, or
destination check. The message alone does not identify which check failed.

On the same production version, reloading the authorization request to obtain a
fresh consent transaction, then allowing its existing read scopes, successfully
passed `/continue` and reached Cloudflare's One-time PIN login page. This proves
that fresh navigation can work in the local Aside browser; it does not establish
the cause of the user's earlier failure or complete the ChatGPT connection.

Five additional disposable tests execute the navigation module extracted directly
from the downloaded bundle. They cover successful single-use navigation, missing/
mismatched/duplicate cookies without consuming valid state, expiry at ten minutes,
ciphertext tampering, changed destination policy, and unexpected query parameters.
`node --test test/email-proof.test.mjs test/navigation.test.mjs`: 12 passed.
No navigation behavior or production configuration was changed for this probe.

A subsequent user attempt started a new ChatGPT connection without refresh/back
navigation and returned the same message. Expiry or replay is therefore an
unconfirmed hypothesis, not the established cause.

A diagnostic-only version, `d7430b43-dbe2-478a-ac58-869b8645e61b`, was deployed to
100% of production traffic after explicit approval. It keeps the original checks and status/security headers,
replacing the generic failure body with an allowlisted `RAVEN-NAV-*` stage.
No cookie, navigation handle, destination, ciphertext, or underlying error text
is included. Four new regression tests failed against the original implementation
and passed after the change.
`node --test test/email-proof.test.mjs test/navigation-diagnostic.test.mjs`: 16 passed.
`node --check saved-navigation-worker.js`: passed.
`STATE-MISSING` cannot distinguish consumed state from state already removed or
hidden by storage expiry; `EXPIRED` identifies only a returned record that fails
its embedded expiry check. Do not infer replay from `STATE-MISSING` alone.
Downloaded saved source matches the tested SHA-256
`a193da23f76fca5c20845efe6750687f0037ec0477f73b97e041c4f8a51f1c60`.
Bindings and runtime configuration match `9ffd1c68`. Deployment API readback
confirmed `d7430b43` at `percentage: 100`. A synthetic malformed-handle request
returned HTTP 400 with `RAVEN-NAV-REQUEST` and `Cache-Control: no-store`.
OAuth metadata remained HTTP 200 with the existing issuer, `private_key_jwt`, and
S256 contract. This probe verifies diagnostic deployment, not the real failure
branch.

The approved diagnostic version subsequently returned
`Raven navigation unavailable [RAVEN-NAV-COOKIE-MISSING]` during the user's new
connection. The user starts in the ChatGPT desktop app and continues in Aside.
The confirmed failure is absence of the cookie matching this navigation handle;
the evidence does not determine whether it was rejected, lost, or sent from a
different browser context. It does not establish expiry or missing server state,
because the cookie check occurs before storage access.

The minimal compatibility version, `430f4855-083d-4162-9cc7-526018114553`, serves
100% of production traffic after explicit approval. It changes only `navigationPage` from HTTP 200
with HTML meta refresh to HTTP 303 with a same-origin `Location: /continue?...`.
The fallback link remains; all cookies, navigation encryption, destination checks,
single-use consumption, and identity verification remain unchanged. HTTP 303
provides the standard [POST-to-GET navigation contract](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/303). Client handling of the HTML
refresh is a hypothesis pending a live attempt, not a confirmed platform bug.

Four new 303 regression tests failed with `200 !== 303` before the change.
`node --test test/all.test.mjs`: 20 passed after the change, including upstream
and denial redirects, cookie preservation, binding rejection, expiry, and replay.
`node --check navigation-303-worker.js`: passed. The candidate SHA-256 is
`fac303d9f0da63caabdf6dd336c29407e185229a17dfba9e90726bff5d2a337a`.
Downloaded saved source matches that exact hash; `node --check
saved-navigation303-worker.js` passed. Bindings, runtime, and exported handlers
match `d7430b43`. Deployment API readback confirmed `430f4855` at `percentage: 100`.
OAuth metadata remains HTTP 200 with the same issuer, `private_key_jwt`, and S256.
A malformed-handle probe still returns HTTP 400 with `RAVEN-NAV-REQUEST`.
The next app-to-Aside attempt returned `RAVEN-AUTH-02-BINDING-MISSING` with
`cookie-edge:present; cookie-authority:present`. This is the consent POST before
`navigationPage` executes. Some Cookie header reaches both boundaries, but the
cookie matching the submitted consent handle is absent. The evidence does not
establish that HTTP 303 caused this earlier-stage failure or fixed the original
continuation failure.

Read-only Aside history showed an `/authorize` GET followed eight seconds later
by an `/authorize` form submission in that profile. The supplied error tab was
closed before a separate browser investigation could inspect it. Documented
Aside tools expose neither cookie-block reasons nor retained network logs.
The Aside-hosted ChatGPT web comparison returned the same binding-missing error.
App-to-browser handoff alone therefore does not explain it. Aside's third-party
cookies were allowed; a controlled authorization GET returned one correctly
formed consent cookie and `Cache-Control: no-store`.

On `430f4855`, a fresh controlled browser consent reproduced a more specific
failure: the first allow click left the original consent document displayed and
raised an enforced `securitypolicyviolation` for `form-action`. A second click
then returned the exact binding-missing error. This demonstrates that a missing
binding can be a secondary failure after consent has already been consumed.
The 303 change introduced an interaction with the consent document's
`form-action 'self'`: the form navigation continues through the same-origin
303/302 chain to the external identity provider, which Chromium blocks.
The previous claim that an earlier-stage error could not implicate 303 was too
strong: the displayed error follows a second submission, after the first
submission reaches navigation. Retain this distinction when interpreting stage
codes. It does not establish the cause of the older meta-refresh cookie failure.

A one-line candidate changes only the consent GET response's `form-action`
allowlist to self plus the configured authorization and callback origins.
It keeps fixed server configuration as the source, uses no wildcard, and leaves
the form action, origin check, binding, one-use state, and all remaining CSP
directives unchanged. Two focused tests failed against `430f4855`; three passed
after the change. `CSP_CANDIDATE=consent-csp-worker.js node --test
test/all.test.mjs test/consent-csp.test.mjs`: 23 passed. `node --check
consent-csp-worker.js`: passed. Candidate SHA-256:
`d7a7903a192e62782ae020b57087d6877f2713c637322804c92a7fd2c857627c`.
Saved Worker version `0a234439-bb63-40f7-aac5-581d87261d5b`
matches that exact source hash. Other bundled modules, bindings, runtime, and
handlers match `430f4855`.
The downloaded source also passes the 23-test command with
`CSP_CANDIDATE=saved-consent-csp-worker.js` and its syntax check. Production
promotion was explicitly approved for this exact version and completed.
Deployment API readback reports `0a234439` at 100%.

A disposable loopback fixture uses the authorization HTML and headers extracted
from each bundle, synthetic cookies, and separate loopback gateway/login origins.
In actual Aside Chromium, the original CSP reproduced the enforced violation
and retained consent page; the candidate followed the same 303/302 chain to
`SYNTHETIC LOGIN REACHED`. This validates the browser interaction without real
credentials. After production promotion, a fresh controlled authorization GET
returned the updated CSP with HTTP 200 and `Cache-Control: no-store`. In actual
Aside, one allow click then passed consent and navigation and reached the
Cloudflare One-time PIN login page. No OTP was requested or submitted in this
probe; its reused client authorization parameters do not verify a fresh ChatGPT
callback or complete connection. Do not remove
transaction binding to work around the failure. Browser behavior background:
[CSP form-action](https://www.w3.org/TR/CSP3/#directive-form-action).

Full gateway-suite execution and end-to-end ChatGPT tool discovery remain
unconfirmed. The earlier downstream
`token.preflight.assertion_missing` failure is separate and is not established as
fixed by this deployment.

The next user attempt passed the browser flow but showed ChatGPT's generic
account-connection failure. That UI message does not identify the current failing
stage. Direct CLI checks (`python live-cli-check.py`, with an explicit
`RavenMcpDiagnostic/1.0` user agent) verified public authorization metadata,
protected-resource metadata, current ChatGPT CIMD and RSA JWKS availability,
HTTP 401 plus a Bearer challenge for unauthenticated MCP initialize, HTTP 401 for
a synthetic invalid Bearer token, and HTTP 400 `Client assertion required` for a
synthetic unsigned code exchange. These checks do not prove authenticated MCP
initialize or that the latest ChatGPT request omitted an assertion.

Default Python urllib requests instead returned Cloudflare 1010
`browser_signature_banned`. Default Node fetch and the explicitly named
diagnostic client passed the same edge path. Browser Integrity Check is enabled
zone-wide; the existing configuration exception disables only BIC for GET of the
gateway's authorization-server metadata. This user-agent-dependent result does
not establish that ChatGPT was blocked. No BIC setting, rule, Access policy, or
Worker deployment was changed for these comparisons. Current public ChatGPT CIMD
advertises `private_key_jwt` as its legacy preference and supports both `none` and
`private_key_jwt`; the gateway permits only the signed method. A standalone CLI
cannot complete that client authentication using ChatGPT's public keys alone.

An agent-driven Aside CLI attempt then started the existing Raven connection
from ChatGPT web, approved the existing three read scopes, and completed a fresh
Cloudflare OTP login using the matching signed-in owner account. It reached
ChatGPT's `/connector/oauth_callback`, returned to the Raven settings page, and
displayed the same generic account-connection failure. This independently
reproduces the post-login failure without asking the user to repeat the flow.
No OTP or OAuth credentials were printed or saved. The existing bounded
connection-diagnostic lease expired on 2026-10-13, so this attempt does not supply
current token-stage evidence. Keep the latest failure distinct from the earlier
confirmed assertion-missing record.

Diagnostic candidate `6a24bb71-9ab3-40c9-a75c-e987c0259cff` changed only
the binding `RAVEN_CONNECTION_DIAGNOSTIC`, renewed
for the existing maximum 30-minute lease with a fresh attempt identifier.
Downloaded bundle SHA-256 remains
`d7a7903a192e62782ae020b57087d6877f2713c637322804c92a7fd2c857627c`;
runtime and handlers are preserved. `node diagnostic-lease-check.mjs` passes
checks for exact output fields, fixed stage allowlisting, rejection of added
fields, expiry, and the 30-minute maximum. This is configuration validation of
unchanged code rather than a new behavior implementation. Dashboard Real-time
logs is available without enabling stored Workers Logs. After explicit user
approval for a maximum 30-minute diagnostic deployment and rollback, this version
served 100% temporarily. The agent repeated the existing ChatGPT connection and
fresh owner OTP login through Aside CLI. Real-time logs from the second attempt
confirmed, at 2026-10-15 08:24:54 UTC:

- `token.observation.v1.2225011311333109`, HTTP 400;
- `token.preflight.assertion_missing`, HTTP 400;
- `token.response`, HTTP 400.

These records carry the same diagnostic attempt identifier and exact deployed
Worker version. This establishes the immediate current failure: ChatGPT reaches
the gateway token endpoint without the client assertion required by its
`private_key_jwt` policy. It fails before authenticated MCP initialization.
It does not establish why ChatGPT selected this request shape. In particular,
do not label the current cause as a cookie, CSP, BIC, invalid signature, or
origin MCP failure. The first attempt's tail did not provide complete callback
coverage; restarting the live stream before a second attempt supplied the token
records. Absence from an incomplete tail is not evidence of an absent request.

Only fixed diagnostic fields were saved. No OTP, authorization code, token,
request body, or unredacted live-log export was printed or saved. Stored Workers
Logs/Traces were not enabled. After collection, the real-time stream was paused
and its page left, and the approved rollback restored
`0a234439-bb63-40f7-aac5-581d87261d5b` to 100%, confirmed by the deployment API.

Read-only inspection of the existing plugin ZIP found only plugin display
metadata and a reference to its existing development app; it contains no OAuth
client configuration to repair. The settings UI exposed no client-authentication
method editor. Do not assume downloading or re-uploading that wrapper changes
the app's OAuth registration. Current
[OpenAI client registration documentation](https://developers.openai.com/plugins/build/auth#client-registration)
describes signed assertions for CIMD `private_key_jwt`; the gateway advertises
that method alone, and ChatGPT's current public CIMD lists it as its legacy
preference. The observed request still omits the assertion. Resolving this
remaining mismatch requires verifying ChatGPT's registration/negotiation path
or deliberately designing a PKCE public-client flow. Removing the assertion
preflight alone is not a fix: the provider's client authentication must agree
with discovery, client metadata, and the chosen security policy.

The user chose to retain signed client authentication and investigate ChatGPT's
registration/negotiation path. A separate personal development connection,
`Raven CIMD 진단`, was created with explicit CIMD registration, the same gateway,
and only the three read scopes. The existing Raven connection was preserved.
Its first completed OTP flow reported `Authentication succeeded, action
discovery failed`; this message alone did not prove which transport phase passed.

An expired-lease replacement, `e0d35822-5808-4880-8fb0-c6617ca50c85`, renewed only
the same diagnostic binding for ten minutes. Its downloaded code matched the
stable source byte-for-byte; all other bindings, runtime and handlers matched
the first diagnostic candidate. A reinstall/authorization attempt for the new
CIMD connection then supplied live evidence at 08:51:51–08:51:53 UTC:

- `/oauth/token` returned HTTP 200 under the unchanged signed-client policy;
- `mcp.initialize` recorded HTTP 200 with no RPC error;
- initialization notifications returned HTTP 202 using `2025-06-18`.

This verifies a working signed token exchange and authenticated initialization
on the new registration path. It does not prove that the old development
connection's saved registration has changed or that tools are usable.
The diagnostic version was restored to `0a234439` at 08:56:06 UTC. Deployment
history totals approximately 26 minutes across both diagnostic deployments,
within the approved 30-minute limit. Both leases have expired and the live
stream was paused; stored logs were not enabled. The diagnostic plugin was
uninstalled after that failed reinstall comparison, then reinstalled for the
approved compatibility trial below. Its development app remains available,
and the original Raven installation is preserved.

Two HTTP 400 MCP requests carried `MCP-Protocol-Version: 2026-07-28`. Their
timestamps precede the successful legacy initialization, so they are initial
modern-protocol probes, not evidence of a failure after initialization.
[Current MCP compatibility guidance](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/versioning.mdx)
describes HTTP 400 followed by a legacy handshake for older servers. Do not
merely add a new protocol date to the gateway's supported-version array: the
modern revision changes request metadata and discovery semantics.

Independent source inspection found that `tools/list` rejects standard
`params._meta`. A synthetic request reproduced `-32602` before contacting the
origin. A focused candidate permits `_meta` only when it is a non-null object,
while retaining cursor, unknown-field, identity and origin-error checks. This
is a confirmed compatibility defect; the actual ChatGPT request body was not
inspected, so its role in the live action-discovery failure remains unconfirmed.
The [MCP common request schema](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2025-06-18/schema.ts)
defines request metadata independently of tool arguments.

Candidate `c34d64cb-92fe-4927-9d5e-cc45a572a6eb` was saved and verified before
the approved production trial. Its downloaded bundle exactly matches the local two-line change,
SHA-256 `f9c14d4801f23a4a6fa6157fdca71dc29a25392151e577c104ac182e6d328453`.
Bindings, runtime and handlers match `e0d35822`; its diagnostic lease remains
expired. `MCP_CANDIDATE=saved-mcp-list-meta-worker.js
CSP_CANDIDATE=saved-mcp-list-meta-worker.js node --test test/all.test.mjs
test/consent-csp.test.mjs test/mcp-list-meta.test.mjs`: 28 passed; syntax check
passed. Before the change, two metadata tests failed for the intended
`-32602` rejection. The focused MCP tests inject synthetic identity/origin
collaborators and do not establish a live origin connection or complete ChatGPT
tool discovery.

After explicit approval to test this version and restore the stable version on
failure, `c34d64cb` served 100% from 09:32:49 to 09:38:12 UTC on 2026-10-15.
Aside CLI reinstalled the separate diagnostic plugin. Its saved OAuth account
was still present, but refreshing tools returned
`앱을 업데이트할 수 없습니다. 다시 시도하세요`.
A fresh connection through consent and owner OTP then returned
`Authentication succeeded, action discovery failed` again. This trial did not
resolve ChatGPT action discovery; permitting request `_meta` is insufficient.
That trial did not identify the failing RPC stage or origin response.
No diagnostic lease was renewed and no request body was inspected.

The approved rollback restored `0a234439-bb63-40f7-aac5-581d87261d5b` to 100%
at 09:38:12 UTC, verified through the deployment API. The compatibility candidate
remains saved but inactive. The diagnostic plugin remains installed with no
usable tools; the original Raven installation was not modified. Keep this
failed production trial distinct from the earlier verified signed token exchange
and initialization. Do not treat the generic authentication-success message as
new token-stage trace evidence or claim the overall connection is fixed.

Source inspection and a full-bundle SDK reproduction establish that the gateway's
`mcp.initialize` response is local: it does not call the origin. The first origin
connection occurs inside `tools/list`, through `withOrigin`, which performs a
separate SDK initialization before listing tools. Consequently, the earlier
successful external initialization does not establish origin availability or
Service Auth success. The actual bundled SDK tolerates its background GET being
rejected with 405; a focused test confirms listing still succeeds. Do not treat
that GET alone as the cause. Origin initialization rejection, list rejection and
invalid tool schemas all reproduce the same external `-32603` response.

Diagnostic-only candidate `62a4d36d-3c46-4279-9c28-bd5f1465702d` separates origin
connect, HTTP status, JSON MIME type and SDK schema rejection through fixed stage
codes. It retains the existing six-field diagnostic projection, lease expiry and
128-record limit; neither request content nor exception details are recorded.
Downloaded source exactly matches the tested candidate, SHA-256
`07e55f34c6edff27d3ef7210e76d06b3a42a89c85a543922dee8fdde5255d6f2`.
Runtime and non-diagnostic bindings match the stable version. Its diagnostic
lease remains expired and the candidate is not serving production traffic.
Focused TDD reproduced six missing-diagnostic failures against the stable bundle
before the candidate passed all seven focused cases. The full selected run of
`node --test test/all.test.mjs test/consent-csp.test.mjs
test/origin-discovery-diagnostic.test.mjs test/origin-sdk-discovery-review.test.mjs`
passed 34 tests; syntax validation passed. The focused tests exercise the full
bundled SDK with synthetic origin responses, not the live origin.

The user explicitly approved one Durable Objects restart, which was completed to
start the live stream. Ten-minute lease variants `78e` and `a66` reused the
`62a4d36d` diagnostic code for production collection. `a66` supplied token HTTP
200 and external initialization HTTP 200, but its origin classification was
incomplete. Missing origin records in that capture do not establish that no
origin request occurred. Stored observability was not enabled.

The collector originally emitted diagnostic logs inside its own Durable Object
RPC invocation. A focused change returns the validated record to the originating
caller, which revalidates and logs it there. The shared collector still enforces
the 128-record quota; exact six-field output, fixed stages, attempt/version
identity, lease expiry and the one-second RPC budget remain enforced. Diagnostic
failure does not change authentication or MCP behavior. Two focused tests failed
against the original delivery path; all seven passed after this change. The
selected regression run passed 41 tests:

```powershell
$env:DIAGNOSTIC_DELIVERY_CANDIDATE = 'caller-origin-discovery-diagnostic-worker.js'
$env:ORIGIN_DIAGNOSTIC_CANDIDATE = 'caller-origin-discovery-diagnostic-worker.js'
$env:CSP_CANDIDATE = 'caller-origin-discovery-diagnostic-worker.js'
node --test test/all.test.mjs test/consent-csp.test.mjs test/origin-discovery-diagnostic.test.mjs test/origin-sdk-discovery-review.test.mjs test/diagnostic-caller-delivery.test.mjs
```

Syntax validation passed. The downloaded saved version `afe8b7ef` matches the tested
`caller-origin-discovery-diagnostic-worker.js` source, SHA-256
`d83dad576f67b46360d8f30486bb2da16aac2c31b504de0af9a9a37cce4703e8`.

Production trial `bfe8b101-2d30-4cdb-a450-b12b799bf7d9` supplied six validated
fixed-field records for an Aside CLI tool refresh at 2026-10-15
15:20:35–15:20:37 UTC. They establish this sequence:

- `origin.connect.start`;
- `origin.http.initialize` with HTTP 403;
- `origin.connect.failed`;
- external `mcp.tools.list` with HTTP 200 and RPC error `-32603`.

This confirms the live failure boundary: the gateway's separate origin
initialization is rejected before origin tool listing or schema validation can
complete. External initialization success does not test this boundary. That
capture alone did not identify Access, BIC, the Tunnel connector, or the Rust
handler as the HTTP 403 producer. Read-only Access log
inspection around that window, including non-identity events, found no matching
event; that absence is not proof that Access was bypassed. BIC is enabled, and
the Tunnel has a Darwin arm64 connector, but neither fact attributes this 403.

After that trial, the approved rollback restored
`0a234439-bb63-40f7-aac5-581d87261d5b` to 100%, verified through the deployment
API. This is a historical rollback, not a statement of the latest deployment.
Signed client authentication, OTP, PKCE and authorization checks
remain enforced. At that stage, ChatGPT action discovery remained unresolved.

Two independent compatibility checks constrain interpretation of that trace:

- `node --test test/origin-workers-no-eval.test.mjs`: five passed with string
  code generation disabled. Constructing the actual bundled SDK client and
  listing ordinary tools succeeds. A supplied `outputSchema` triggers AJV's eval
  restriction; the current Rust catalog supplies no output schema. This does not
  explain an HTTP 403 during origin initialization.
- `STANDARD_META_CANDIDATE=mcp-standard-meta-worker.js node --test
  test/mcp-standard-meta.test.mjs`: eight passed; three failed against the stable
  bundle before the candidate. This extends the confirmed standard request
  `_meta` compatibility defect to list and call while preserving validation and
  authorization. At that stage the candidate was not promoted. The observed HTTP
  403 failures occur before tool listing, so metadata compatibility alone cannot
  resolve them.

Later fixed-stage evidence narrows the origin rejection without recording raw
headers, response text or credentials. Trial
`3f671eef-21b8-4ed9-8cb6-feded57d05ab` classified the HTTP 403 as
`origin.http.403_cloudflare_page`; that generic template does not identify a
rejecting component or policy. A 64KiB bounded sampler combined with an explicit
gateway User-Agent, version `272f3cff-4420-44b8-8da9-78fb772447dc` serving 100%,
recorded `origin.http.403_access_page` at 2026-10-15 16:03:36 UTC. Origin
initialization still returned HTTP 403 and external `tools/list` still returned
`-32603`. Changing the User-Agent did not fix the failure. Template classification
is supporting evidence rather than proof of the exact Access policy decision.

A leased diagnostic compares the runtime `ORIGIN_ACCESS_CLIENT_ID` binding with
the digest of the registered Service Auth metadata's `client_id`. It emits only
fixed match/mismatch and boundary-whitespace stage names; neither credential
values nor their hashes are logged. The original candidate, source SHA-256
`60ac151de2433f05a16d2c708b59225c41d2341eb2f2e91322bd8d179fc7c585`,
contained an invalid 65-character expected digest introduced while transcribing
wrapped terminal output. Its synthetic comparisons did not validate the
production constant's exact length. The earlier claim of a
confirmed runtime client ID mismatch is retracted: mismatch stages from that
probe, including `1c252870`, `97c7abca` and `761`, cannot establish ID inequality.
Their separate origin HTTP 403 and Access-page observations remain valid.

The corrected diagnostic uses the programmatically saved expected digest and
validates its exact 64-character hexadecimal form. Its source SHA-256 is
`02d50fc7f0b8bff83e1d935314610cb29f1c658d80bb37eb3e83a38e0ff7c910`.
Two focused regressions failed against the invalid candidate before all six
passed against the correction:
`ORIGIN_CLIENT_ID_DIAGNOSTIC_CANDIDATE=origin-client-id-corrected-diagnostic-worker.js
node --test test/origin-client-id-diagnostic.test.mjs`. The selected regression
run passed 67 tests and syntax validation passed. Saved version
`16283a79-9aa9-450f-be26-d2daf83e4252` served 100% with the actual execution
version verified. At 2026-10-15 16:33:50 UTC it recorded
`origin.credentials.client_id_match`, origin HTTP 403 with
`origin.http.403_access_page`, and external `mcp.tools.list` RPC error `-32603`.
The Worker ID binding had already been privately set to the registered metadata
ID. This proves that binding matches after that assignment; the original value
before the assignment is unknown. It does not prove a previous configuration
error, a secret-edit UI defect, or a valid Client Secret.

The isolated verification directory retains the invalid-probe records with an
explicit retraction and the corrected fixed-field evidence
`162-correct-client-id-origin-access-403-safe-records.json`. No credential value
was recorded. That ID-match observation alone does not establish successful
origin admission, complete ChatGPT tool discovery, or tool use.

A replacement Service Auth token was created and its ID/Secret pair privately
bound to the Worker. The existing token was preserved. The existing origin
Service Auth policy includes the old and new tokens as alternatives; its Require
and Exclude conditions were preserved. That modified policy's `app_count` was
one; this is not a token-wide application count or proof of account-wide token
admission boundaries. No credential values were logged or saved with the
verification evidence.

Version `1d48dca3-820d-47e5-adc9-9fffb2d22599` served 100% and supplied successful
fixed-field records at 2026-10-15 16:41:17–16:41:18 UTC:

- origin `initialize` HTTP 200 and initialization notification HTTP 202;
- `origin.connect.ok`;
- origin `tools/list` HTTP 200 and `origin.action.ok`;
- external `mcp.tools.list` HTTP 200 with no RPC error.

The SDK's optional background GET returned HTTP 405, which did not prevent this
successful listing. ChatGPT's tool refresh no longer reported failure. The
capture's `client_id_mismatch` stage is expected: the corrected probe still
compares with the old token ID, while the replacement pair has a new ID. It is
not evidence that the working replacement pair is invalid.

This confirms restored origin admission and tool discovery after replacing the
effective Service Auth pair and admitting the replacement token through the same
policy. It strongly implicates the old effective credential path, but does not
prove the exact old Secret bytes were wrong or that the original Client ID was
incorrect. Safe evidence is
`1d48-new-origin-token-tools-list-success-safe-records.json`. An actual tool call
and the final deployment after removing temporary diagnostics are separate
verification boundaries; neither is established by this discovery-only capture.

The pre-metadata clean deployment was
`354191d8-10fb-465c-b1b9-f9d8cd5d6f78` at 100%. Its source is byte-for-byte equal
to stable `0a234439`, SHA-256
`d7a7903a192e62782ae020b57087d6877f2713c637322804c92a7fd2c857627c`.
The downloaded saved version `c9afcbdf-def6-4618-b060-c09929844e69` matches that
source. Temporary origin response sampling, the trial User-Agent and client ID
probe are removed. The diagnostic binding is the literal text `null`, so the
remaining stable diagnostic helpers are inactive. Runtime and other binding
projections were preserved, including the working replacement credential
bindings. The policy continues to include only the existing old and new tokens
as alternatives, with Require and Exclude conditions preserved; the old token
was not removed.

Verification of the downloaded clean source:

```powershell
node --check saved-clean-origin-gateway-worker.js
$env:CSP_CANDIDATE = 'saved-clean-origin-gateway-worker.js'
node --test test/all.test.mjs test/consent-csp.test.mjs test/origin-sdk-discovery-review.test.mjs test/origin-workers-no-eval.test.mjs
```

Syntax validation passed; all 32 tests passed. These checks establish source
cleanup and regression behavior, not an actual post-clean ChatGPT tool call.
A fresh ChatGPT settings tool refresh started at 2026-10-15 16:58:38 UTC. A
subsequent UI read reported `refreshFinished=true`, `failed=false` and
`positiveStatus=false`: refresh finished without an observed failure, but no
affirmative success status was visible. This UI-only result does not establish
an authenticated RPC or an actual read-only tool call. The operational cleanup
must preserve the new credential bindings: promoting an old immutable version
does not establish that working credentials survive its binding snapshot.

The metadata fix first served as `4983cb81-a2e1-4427-9f68-1abfdca0b8f2` at 100%,
superseding `354191d8`. Its downloaded source SHA-256 is
`7f3abd4408d00947ed8027afb52ce76eadf02a86006fbc3fd6822d2f3c1bdfa8`.
The only behavior change from the clean source is at the two `tools/list` and
`tools/call` parameter validators: standard `_meta` is accepted as a non-null
object, while existing unknown-field, argument and authorization checks remain.
The diagnostic binding remains literal text `null`; other binding projections
and runtime match the clean deployment, including the replacement credentials.
The eight focused metadata tests produced five passes and three intended
failures against the clean baseline. Downloaded-source verification passed all
40 selected tests and syntax validation:

```powershell
node --check saved-mcp-standard-meta-worker.js
$env:CSP_CANDIDATE = 'saved-mcp-standard-meta-worker.js'
$env:STANDARD_META_CANDIDATE = 'saved-mcp-standard-meta-worker.js'
node --test test/all.test.mjs test/consent-csp.test.mjs test/origin-sdk-discovery-review.test.mjs test/origin-workers-no-eval.test.mjs test/mcp-standard-meta.test.mjs
```

An isolated, unsaved Cloudflare HTTP preview used the actual existing origin SDK
helper to list 79 raw origin tools and call `todo_options` with `{}`. The call
succeeded and returned the six static item types: area, project, goal, routine,
task and event. This tests the origin catalog and actual tool execution through
the helper, not ChatGPT's OAuth context or scope-filtered catalog.

Submitting the permanent origin Secret as a preview request header was rejected
by automatic approval review and was not executed. The executed preview used a
temporary nonce gate; the origin Secret remained only in the existing trusted
`withOrigin` upstream path. The probe was neither saved nor promoted. Its request
header and nonce were cleared, and the editor export was restored to the clean
metadata source. Production remained `4983cb81`. Safe evidence files are
`preview-origin-sdk-safe-outcome.json`, `preview-cleanup-safe-outcome.json` and
`meta-final-production-verification.json`.

An actual ChatGPT authorization and discovery attempt then verified the
scope-filtered gateway catalog. An initial Durable Object diagnostic capture
from `99008ef4-1f1c-48f7-a0cb-42d06b0281db` was incomplete after initialization;
its HTTP 200/202 observations alone did not prove a successful `tools/list` or
the absence of that request. A caller-side fixed-field diagnostic, source
SHA-256 `2a60218cd995c52e53cb82efff1987f5d3bc4134bd79363ae77abf526c4863c3`,
served as `e97604ed-ed71-4259-913c-8a0c6f246ddd` and supplied these positive
records at 2026-10-15 17:42:03–17:42:04 UTC:

- `mcp.catalog.scope.todo_present`;
- `mcp.catalog.visible.todo_present`;
- `mcp.tools.list` HTTP 200 with no RPC error.

For this attempt, the token carried the ToDo read scope and the gateway's filtered
catalog included `todo_options`. An empty grant or empty filtered catalog does
not explain this attempt. One older row could not be read from the live-log UI;
the positive caller records establish the stated result without an absence
claim about that row. The cause of the earlier Durable Object observation gap
remains unknown. Safe records are `catalog-caller-safe-records.json` and
`catalog-caller-live-outcome.json`.

Temporary catalog and caller diagnostics were removed in four source cleanup
replacements. The final production deployment is
`0df09a46-e843-4b22-b313-910ac92bbc8a` at 100%, with diagnostic binding literal
text `null` and other bindings and runtime preserved. The saved cleanup version
prefix is `b958aa14`. Its deployed source, downloaded as
`saved-final-deployed-metadata-worker.js`, equals the tested
`saved-final-clean-metadata-worker.js` and the clean metadata source byte-for-byte,
SHA-256 `7f3abd4408d00947ed8027afb52ce76eadf02a86006fbc3fd6822d2f3c1bdfa8`.
All 40 selected tests and syntax validation passed for that identical source.
Source ETags also matched. A prior whole-metadata comparison differed only in
`last_deployed_from`; that difference did not establish a source mismatch.
No preview probe or temporary caller/catalog instrumentation remains. Final
deployment evidence is `final-metadata-cleanup-deployment.json`.

The earlier ChatGPT UI self-test did not verify tool invocation. Settings showed a
connected account and development version; the missing account selector in an
earlier agent view is not evidence that no account was connected. A fresh chat
opened through the plugin page's `채팅에서 사용해 보기` button retained the app
chip while the prompt was typed, and the enabled prompt was sent. The response
classifier reported tool unavailability; no static enum result or actual tool
invocation was verified. The model was unchanged, and that conversation's
account context remained unconfirmed. Safe evidence is
`chatgpt-direct-try-chat-safe-outcome.json`; temporary settings screenshots were
deleted and no account identity is recorded here. That UI attempt did not
establish completion beyond successful server catalog delivery.

A fresh-import comparison was inconclusive because OAuth UI attachment timed out
(`OAUTH_UI_ATTACHMENT_TIMEOUT`); attaching to the pending consent tab also timed
out at CDP `Page.enable`. New plugin creation is unknown, and neither OAuth
completion nor a tool invocation was verified. This automation limit does not
prove a cached-registration cause or an OAuth server rejection. Existing plugins
and server configuration were unchanged. Safe outcome:
`chatgpt-fresh-import-safe-outcome.json`.

Actual ChatGPT connector tool invocation subsequently succeeded on the
explicitly reauthorized connection. Its immediate `todo_options` retry returned
`isError: false`, eight static types, eight enum groups and `item: null`; no
private records were read and no mutation occurred. Two consecutive calls
succeeded without another authorization prompt, checked at 2026-10-16 00:27:40
UTC. Another saved connection
returned `UNAUTHORIZED`, so this success applies only to the verified
reauthorized connection. Production remains `0df09a46` at 100% with diagnostics
off. Safe evidence is `chatgpt-actual-model-tool-success.json`. The exact reason
for the earlier UI no-tools response remains unconfirmed.

A fresh Aside CLI ChatGPT chat also completed successfully after opening the
plugin's try-chat entry with the app chip preserved. Its expanded work trace
showed `Raven CIMD 진단 생성 옵션 확인`, and the completed assistant response
reported success with eight enum groups, eight types and `item: null`. This is
UI execution-trace and completion evidence; raw tool request and response views
were not opened. The structured-result verification comes from the two separate
actual connector calls above. Safe UI evidence is
`chatgpt-aside-final-tool-success.json`. This confirmation applies to the same
verified connection; it does not establish other saved connections' status.

## Read/write consent and domain verification

A separate personal CIMD connection requested the three domain read scopes and
three domain write scopes as both default and required scopes. All six appeared
in consent and owner OTP completed. The existing read connection was not
automatically upgraded. The new connector exposed 73 tools, including 40 newly
available tools; purge, export and image tools were absent. Gateway source,
bindings and deployment were unchanged; signing, OTP, PKCE and scope checks remain
enforced.

All test mutations ran through Aside CLI and ChatGPT on that new connection.
One newly created task was updated, completed and archived. Independent actual
calls on the same new connector verified the edited title, archived state and
preserved completion timestamp. History contained exactly the four actions
`propose_task`, `update_item`, `complete` and `archive`, with timestamps matching
the Aside assistant JSON and `next: null`. The two actual readback calls required
no authentication retry. No existing record was modified. The test record remains
archived with its audit history. At that stage, Ledger and Health write consent
was included, but their mutations had not yet been tested. At 2026-10-16 01:17:19
UTC, the additional Aside get/history read succeeded without an authentication
prompt or an expired connection alert. Parsed rendered JSON matched the actual
connector state, timestamps and all four history rows exactly.

Keep verification on the intended connection. The bundled OAuth provider's
`completeAuthorization` defaults to replacing grants for the same user, CIMD
client, redirect URI and resource; scope is not part of that replacement
predicate. Reauthorizing another read-only connection can therefore revoke the
new write grant. The observed interruption was temporally consistent with that
source path, but revocation logs were not captured, so it is an explanation
supported by source rather than a confirmed cause of that interruption.

On 2026-10-16, the three old registrations were deleted through Aside UI and
the verified read/write registration was renamed `Raven` with its registration
ID retained. Settings then listed exactly one Raven registration. A fresh Aside
ChatGPT chat used Raven and returned the archived test record and all four audit
actions, matching direct connector reads without reauthorization or an
authentication error. The catalog retained 73 tools, including create, update
and transition. Cleanup made no new writes to domain records or gateway changes;
the earlier lifecycle verification establishes write behavior. Safe evidence is
`chatgpt-raven-registration-cleanup.json`.

A subsequent 2026-10-16 retest used the retained `Raven` registration with its
ID unchanged. Fresh Aside ChatGPT chats created one new test item, then updated,
completed and archived it. Direct connector reads matched the returned UI JSON
and exactly four audit actions: `propose_task`, `update_item`, `complete` and
`archive`. The archived item retained its completion timestamp. Queries bounded
to its unique test title returned zero active and one archived item, with
`next: null`. No pre-existing record was changed, and no reauthorization or
gateway code/deployment change was needed. Safe evidence is
`chatgpt-raven-retained-write-retest.json`.

On 2026-10-16, fresh Aside ChatGPT tests on the same Raven registration also
created, updated and archived one Ledger expense and one image-free Health snack
diet record. The expense amount input changed from string `1` to `2` with its
content updated; direct reads matched the UI stages and final `deleted_at`.
Scoped queries found zero active and one archived expense, with
`next_offset: null`. The diet record's food name and note were updated, using
the latest `expected_updated_at` for update and archive. Direct reads and its
three audit actions (`create`, `update`, `archive`) matched the UI stages and
timestamps; `deleted_at` was set and the exact active-food query returned zero
records with `next_offset: null`. Both test records remain archived. No existing
records, images, health events, daily metrics or master data were changed; no
authorization, code or deployment changes were needed. Safe evidence is
`chatgpt-raven-ledger-health-write-retest.json`.

Before the fix, `ledger_audit(record_type=entry)` returned `items: []` and
`next_offset: null` in both Aside ChatGPT and direct calls. The MCP catalog
advertises `entry`, while Ledger mutations write audit events as `ledger_entry`;
the unpatched adapter passed the requested type through without translation
(`raven-api/src/mcp/{catalog,mod}.rs`,
`ledger-engine/src/application/entries.rs`). This contract mismatch caused the
empty audit response; it did not establish that storage had no history.

An isolated local adapter fix maps public `entry` to canonical `ledger_entry`
without changing the schema, authentication or storage. A temporary-store
regression reproduced zero audit items before the fix, then verified
create/update/archive snapshots across two pages after it. All 31 MCP tests and
20 Ledger route tests passed under Ubuntu WSL. At the 2026-10-16 03:16:51 UTC
checkpoint, the live service still returned an empty entry audit, and deployment
and fresh Aside verification remained pending runtime access. No live test
records were added during local verification. Safe local evidence is
`ledger-audit-entry-alias-local-verification.json`.

The three-line adapter mapping was deployed and verified on 2026-10-16 without
changing authentication, the public schema or storage. An isolated build based
on operational v0.4.32 (`f3dc889`) passed 30 MCP, 18 Ledger route and three MCP CLI
tests, a release build and temporary-home smoke before replacing only
`com.raven.mcp`. Mac Aside CLI and ChatGPT on the retained Raven connection
created exactly one test expense for 1 KRW, updated the same record to 2 KRW and
archived it. Public `ledger_audit(record_type=entry)` returned two events with
`next_offset: 2`, then one with `next_offset: null`, verifying all three
create/update/archive snapshots. Independent connector reads confirmed the
same record, archived state and canonical `ledger_entry` events; scoped queries
found zero active and one archived record, and the baseline balance was restored.
The independent verification made no additional mutations. Safe final evidence
is `chatgpt-raven-ledger-audit-final-verification.json`.

Safe evidence: `chatgpt-write-connection-setup.json`,
`chatgpt-write-create-readback.json` and `chatgpt-write-end-to-end.json`. Record
identifiers, titles, connection identifiers and credentials are omitted here.

When diagnosing a later authentication stage, retain evidence of earlier verified
stages. Restoring a strict baseline can restore this missing-claim failure as well.
Do not remove claim checks globally or change the Rust Access JWT verifier to
compensate for this gateway-specific OIDC contract.

Related operational evidence: the chat titled `Raven 동의창 접근 진단`, the
immutable Worker versions above, and `gateway/src/{upstream,otp-contract,policy}.js`.
