# SIGNAL Drive local backend

Node.js 22 or newer. No npm dependency or install is required by this server.

```sh
node server/start.mjs
node --test tests/server*.mjs
```

The default address is `http://127.0.0.1:3217`. Static browser files are read only from `web/`. The backend does not register a service worker or cache signal responses. `PORT` may select a different local port. `SIGNAL_HOST` defaults to `127.0.0.1`; a non-loopback host requires `SIGNAL_PUBLIC_ORIGIN` and a trusted HTTPS reverse proxy. Do not expose this development server directly to the internet.

## Default live mode

`targets.json` is deliberately an empty array. The included `targets.example.json` is **unverified** and cannot produce a live signal. There is no real, field-verified mapping in this package. A key alone cannot activate live display.

The server accepts a `TDATA_API_KEY` environment variable. Do not put it in a browser URL, Android resources, source code, frontend storage, a screenshot, or a committed file. No public CORS proxy or browser-supplied key mode exists. The only upstream endpoint is Seoul's current phase plus remaining time API:

https://t-data.seoul.go.kr/apig/apiman-gateway/tapi/v2xSignalPhaseTimingFusionCurrentInfo/1.0

Official schema: https://t-data.seoul.go.kr/dataprovide/trafficdataviewopenapi.do?data_id=10381

`SIGNAL_TARGETS_FILE` can point to an owner-controlled registry file outside the source tree. Before approving a mapping, independently validate its intersection ID, approach direction, movement/signal group, source permission, and field correspondence. Only then record the evidence reference, verification time, and mapping version in that file. Do not use the synthetic tests or official documentation's example ID as field verification.

## HTTP contract

- `GET /api/health`: nonsecret server availability, `keyConfigured`, configured/verified target counts, approved public target descriptors and source-age policy. `ok:true` means this local server works, not that Seoul data or a vehicle is validated.
- `GET /api/signal?target=<registry-id>`: source `live`; status `verified` or `unknown`.
- No client ID, approach, movement, key, upstream URL, or `verified` query override is accepted. Unknown query fields and duplicate target values are rejected.
- All API responses use `Cache-Control: no-store, max-age=0`. No `Access-Control-Allow-Origin` is emitted. Foreign Origin, cross-site Fetch Metadata and unexpected Host values are rejected.

Public target descriptors contain `id`, `label`, `intersectionId`, `approach`, `movement`, and `mappingVersion`. Approaches are `N`, `NE`, `E`, `SE`, `S`, `SW`, `W`, `NW`. Movements are `STRAIGHT`, `LEFT`, `UTURN`, `BUS`, `BICYCLE`, `PEDESTRIAN`. Mapping evidence is not returned to the browser.

Every packet contains:

```json
{
  "schemaVersion": 1,
  "status": "unknown",
  "reason": "target-not-configured",
  "target": null,
  "source": "live",
  "sourceTimestampMs": null,
  "receivedAtMs": 1793838000000,
  "phase": null,
  "remainingDeciseconds": null,
  "expiresAtMs": null
}
```

For an approved, fresh, supported signal, `status` and `reason` are `verified`, `phase` is `RED` or `GREEN`, and `remainingDeciseconds` is the **source** value in tenths of a second. `expiresAtMs = sourceTimestampMs + remainingDeciseconds * 100`. The client must use source time and the expiry, recheck the 3-second source-age gate continuously, and hide display on expiry or uncertainty. It must not decrement an interval counter, extend expiry on receipt, or generate the next phase.

The v0.1 policy rejects data 3,000 ms old or older and any future source timestamp. This conservative development threshold has **not** been validated as a real driving safety threshold. Source timestamps must be epoch **milliseconds**. The only phase strings currently recognized are `stop-And-Remain` and `protected-Movement-Allowed`; ambiguous, clearance, flashing and permissive states remain unknown. No state is inferred from remaining time or another direction. No pedestrian/vehicle inversion exists.

Unknown reasons include `mapping-unverified`, `target-not-configured`, `api-key-missing`, `no-data`, `id-mismatch`, `missing-timestamp`, `future-timestamp`, `stale`, `missing-phase`, `unsupported-phase`, `missing-remaining`, `invalid-remaining`, `expired`, `ambiguous-data`, `upstream-timeout`, `upstream-unavailable`, `upstream-invalid`, `rate-limited`, `invalid-request`, `clock-invalid`. In every unknown packet, `phase`, `remainingDeciseconds`, and `expiresAtMs` are null.

## Bounds and checks

Upstream requests time out after 2 seconds, redirects are rejected, response bodies are bounded to 256 KiB, requests for the same intersection in flight are shared, and at most 8 upstream requests run concurrently. Per-client (90/minute), global (300/minute), and bounded-client rate limits protect this local MVP; production tenancy, quotas, monitoring and reverse proxy controls remain separate deployment work. Error responses never relay an upstream URL, key, or exception message.

Tests use synthetic registries, fake keys and mocked upstream requests. They do not contact Seoul or prove real mapping accuracy. HTTP tests require permission to bind a temporary loopback port.
