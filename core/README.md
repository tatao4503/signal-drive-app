# SIGNAL Drive core

Pure Kotlin/JVM signal validation. No Android, network, location or browser dependencies.

```kotlin
import kr.signal.drive.core.*

// The default LIVE_ONLY mode has no approved mapping and cannot display a live signal.
val engine = TrustEngine()
val target = SignalTarget("DEMO-001", Approach.SE, Movement.STRAIGHT)
val now = System.currentTimeMillis()
val packet = SignalObservation(
    intersectionId = "DEMO-001",
    approach = Approach.SE,
    movement = Movement.STRAIGHT,
    phase = SignalPhase.GREEN,
    provenance = Provenance.SIMULATION,
    sourceTimestampEpochMs = now,
    remainingDeciseconds = 120,
)
val decision = engine.evaluate(target, packet, now, DisplayMode.DEMONSTRATION)
// decision.kind == DisplayKind.DEMONSTRATION
// decision.sourceLabel is permanently marked as simulation.
// Remaining time is anchored to sourceTimestampEpochMs + remainingDeciseconds * 100.

// UNKNOWN and RESTRICTED lock settings. UNRESTRICTED must come from a vehicle adapter.
val ux = VehicleUxPolicy.evaluate(VehicleUxState.UNKNOWN)
check(!ux.canOpenSettings)
```

`TrustEngine(policy = TrustPolicy(), approvedMappings = emptyList())` owns a defensive copy of the authoritative mapping registry. `SignalObservation` contains **no verified boolean**. LIVE_ONLY requires a VERIFIED registry entry with nonempty evidence reference, exact mapping id/version and exact intersection/approach/movement in both target and observation. A mapping registry must come from reviewed application/server configuration; never construct it from query parameters or a browser toggle.

`evaluate(target: SignalTarget?, observation: SignalObservation?, nowEpochMs: Long, displayMode: DisplayMode = LIVE_ONLY): DisplayDecision` never synthesizes a subsequent phase. All unknown decisions carry null phase/countdown. Source age defaults to a conservative **3,000 ms development threshold**, not an experimentally established automotive safety limit. Future source timestamps are rejected by default. Demonstration packets require an explicit DEMONSTRATION display mode and SIMULATION/REPLAY provenance; they never become verified live data, including when their target happens to match an approved registry entry.

`ClockGuard.evaluationTimeMs(wallTimeMs, elapsedRealtimeMs)` returns the trusted epoch time to pass into `TrustEngine`, or null when the session is invalid. Trusted time advances by at least the monotonic delta from the previous trusted sample, even when a small backwards clock correction occurs between increasing wall samples. This session floor prevents accumulated corrections from extending freshness or resurrecting an expired countdown. Sample at render and asynchronous response boundaries as well as timer ticks; never fall back to raw wall time for an existing packet. `checkpoint(...)` remains a boolean compatibility API and advances the same floor. `reset()` clears the floor and invalid latch for a new session: always clear the old packet at the same time, then acquire a new sample. This is not a time synchronization service, and the development tolerance is not a validated driving-safety threshold.

Wire enum values are uppercase compact approach codes (`N`, `NE`, `E`, `SE`, `S`, `SW`, `W`, `NW`) and uppercase movement codes (`STRAIGHT`, `LEFT`, `UTURN`, `PEDESTRIAN`, `BUS`, `BICYCLE`). Official source field prefixes are retained separately in `Approach.apiPrefix` and `Movement.apiToken`. Official raw phase normalization only recognizes `stop-And-Remain` and `protected-Movement-Allowed`; it does not guess yellow from remaining duration or infer pedestrian color from vehicle color.

Tests are a dependency-free Kotlin main in `src/test/kotlin/kr/signal/drive/core/CoreTestMain.kt`. Root project tooling compiles this with main sources and runs `kr.signal.drive.core.CoreTestMainKt`.
