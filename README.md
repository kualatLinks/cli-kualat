# @kualat/cli

Command line for kua.lat. Forward webhook deliveries to localhost while developing, shorten links, and manage webhook subscriptions without opening the dashboard.

Status: in local development. The package is not on npm yet.

## Install

```
npm install -g @kualat/cli
```

Works on Node 18 and newer. Depends only on `@kualat/sdk` and `@kualat/webhooks`.

## Authentication

Every command takes `--api-url` and `--api-key`, or reads `KUALAT_API_URL` and `KUALAT_API_KEY` from the environment. The flags win.

```
kualat account --api-url https://kua.lat/api --api-key key_live_xxx
```

## `kualat listen`

The webhook workbench. It creates a temporary subscription on your account, receives the deliveries live, verifies their Standard Webhooks signature, prints each event, and forwards the original body to your local server. Stopping it (Ctrl+C, or closing the pipe) removes the subscription it created.

```
kualat listen --forward-to http://localhost:3000/hooks
```

```
Receiving on  http://127.0.0.1:8080
kua.lat calls http://127.0.0.1:8080/kualat
Forwarding to http://localhost:3000/hooks
Subscription  9 (signatures verified)
→ link.clicked  dlv_7Q2m0Jp4Cc1s8Rk3xxxx  200 (12ms)
```

Where does the receiver live? kua.lat must be able to reach it:

- **API on the same machine** (self-hosted, development): the CLI defaults the subscription URL to `http://127.0.0.1:<port>/kualat`. The installation must allow private webhook targets for this; set `WEBHOOKS_ALLOW_PRIVATE_TARGETS=1` in the application environment.
- **API in the cloud**: expose the receiver with a tunnel and pass its address:

```
cloudflared tunnel --url http://localhost:8080
kualat listen --url https://<tunnel-host> --forward-to http://localhost:3000/hooks
```

Options: `--port` (default 8080), `--events link.created,link.clicked` (default `*`), `--webhook-id <id>` to reuse an existing subscription instead of creating one. Forwarding uses a 15 second timeout; a delivery whose target does not answer shows up as 502.

Deliveries that fail the signature check answer 401 and are logged, never forwarded.

## `kualat tail <subscription-id>`

Follow a subscription's delivery log without forwarding anything. Works against any instance since it only polls the API.

```
kualat tail 3 --interval 2
#3  link.clicked  delivered  200  84ms
```

## Links and webhooks

```
kualat links create https://example.com/launch --alias launch --title "Launch"
kualat links list --search launch
kualat links get 7
kualat links delete 7 --yes

kualat webhooks list
kualat webhooks create https://example.com/hook --events link.created,link.clicked --name orders
kualat webhooks test 3
kualat webhooks delete 3 --yes
```

`links create` prints the short URL. `webhooks create` prints the signing secret once, exactly as the API returns it.

`--json` switches every command to machine-readable output, and `--timeout` overrides the 30 second request timeout. `links delete` and `webhooks delete` ask for confirmation unless `--yes` is passed.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | The API call failed (check the `error:` line) |
| 2 | Usage error: missing flags, unknown command, unreachable receiver target |

## Development

```
npm install
npm run check
```

The tests spawn the built CLI against fake HTTP servers, including a full `listen` round trip with a signed delivery.

`package.json` depends on the published `@kualat/sdk` and `@kualat/webhooks`, so a
plain `npm install` resolves them from npm — no sibling folders needed.

While working on the SDK or the webhook verifier, point the dependencies at your
local copies instead:

```bash
npm install @kualat/sdk @kualat/webhooks
```
