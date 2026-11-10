# Shared trust contract fixtures

`trust-fixtures.json` defines portable, deliberately synthetic acceptance cases. The approved mapping inside that test file is **test authority only**, not a verified real-world intersection. It must never be shipped as the application's live registry.

All direction/movement/phase enum values are uppercase. Raw API approach prefixes (`nt`, `ne`, `et`, `se`, `st`, `sw`, `wt`, `nw`) are not headings or compass estimates; preserve them exactly when normalizing source fields. Preserve source timestamps in epoch milliseconds and remaining time as integer deciseconds. The official API's `RmdrCs` field description specifies 1/10 second despite its name. Do not combine directions or infer a pedestrian phase from a vehicle phase.

Domain fixture field names are explicit Kotlin DTO names. An HTTP adapter converts the backend envelope's `target.id` into `mappingId`, `target.mappingVersion` into `mappingVersion`, `sourceTimestampMs` into `sourceTimestampEpochMs`, and `source` into `Provenance`. The app independently chooses an authoritative registry and should not construct a reviewed mapping from an HTTP `status: verified` claim alone.

For any UNKNOWN result, **phase, remainingSeconds and expiresAtEpochMs must be null**. The display must not retain a previous color or number. Simulation/replay need an explicit DEMONSTRATION display mode, remain labeled on every frame, and may never become VERIFIED_LIVE. A status display is not a permission to proceed, a speed recommendation or an alert.

The default maximum source age of 3,000 ms is a conservative development setting, not a validated automotive safety threshold. Source expiry must be recalculated from actual elapsed time; callback frequency cannot extend it. A clock jump, suspend/resume, server error or target change should clear the active packet and wait for new data.
