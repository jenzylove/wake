# Bitget Demo evidence

This directory holds redacted artifacts from authenticated Bitget **Demo Trading**
calls.

`preflight-20260916065553.json` is a real one, captured 16 September 2026: a
read-only account read returning HTTP 200 and `code 00000` with `paptrading: 1`,
hedge mode confirmed, and no order sent. That packet is the evidence that the
Demo credentials and the HMAC signing path both work.

An earlier revision of `PRD_AUDIT.md` asserted in prose that a minimum size open
and close smoke test had passed, with nothing in the repository to show for it.
That claim has been withdrawn. The only real exchange interaction in this build
should not rest on a sentence in a markdown file.

## Producing an artifact

Read only. Signs an account request with `paptrading: 1` and sends no order:

```sh
npm run bitget:verify
```

The open and close smoke test. Deliberately opt in, minimum contract size, and
it closes what it opens:

```powershell
$env:WAKE_EXECUTION_MODE="bitget-demo"
node scripts/test-bitget-demo-order.mjs --confirm-demo-order
```

Both write a hashed JSON packet here and print its path.

## What is in a packet, and what is not

Kept: the request path and method, order parameters, HTTP status, and the
exchange response verbatim, including `orderId` and `clientOid`.

Never written: `BITGET_API_KEY`, `BITGET_SECRET_KEY`, `BITGET_PASSPHRASE`, and
the `ACCESS-SIGN` request signature.

The writer in [`scripts/bitget/artifact.mjs`](../../scripts/bitget/artifact.mjs)
uses an allow list rather than a blocklist, so a response field it has never seen
is dropped instead of leaking. `assertNoSecrets()` is a second check that refuses
to write if a credential appears anywhere in the serialised packet.

## Scope

Demo Trading only. There is no live trading path in this repository. The
execution route stays disabled unless `WAKE_EXECUTION_MODE=bitget-demo` is set
explicitly, and `liveTradingEnabled` is hardcoded false in
[`lib/bitget-client.ts`](../../lib/bitget-client.ts).
