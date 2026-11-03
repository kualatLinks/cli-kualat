# Changelog

## 0.1.0 (unreleased)

Initial version.

- `kualat listen`: temporary webhook subscription, live signature verification, forwarding to a local server, cleanup on exit. Direct loopback receivers need `WEBHOOKS_ALLOW_PRIVATE_TARGETS=1` on the installation; cloud instances use a tunnel via `--url`.
- `kualat tail`: live view of a subscription's delivery log by polling.
- `kualat links create/list/get/delete`, `kualat webhooks list/create/delete/test`, `kualat account`.
- `--json` machine-readable output, `--timeout`, exit codes 0/1/2.
- Built on `@kualat/sdk`; signatures verified with `@kualat/webhooks`. Both are
  registry dependencies (`^0.1.0`), so `npm install` needs neither the sibling
  folders nor a local build.
