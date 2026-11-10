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

`ClockGuard` compares wall-time progression to monotonic progression. Call `checkpoint(wallTimeMs, elapsedRealtimeMs)` per incoming sample/evaluation, and `reset()` on an application session restart. A caller should clear its packet on suspend/resume and recover with a new sample; this prevents stale clocks from preserving old numbers. ClockGuard is a detector, not a time synchronization service.

Wire enum values are uppercase compact approach codes (`N`, `NE`, `E`, `SE`, `S`, `SW`, `W`, `NW`) and uppercase movement codes (`STRAIGHT`, `LEFT`, `UTURN`, `PEDESTRIAN`, `BUS`, `BICYCLE`). Official source field prefixes are retained separately in `Approach.apiPrefix` and `Movement.apiToken`. Official raw phase normalization only recognizes `stop-And-Remain` and `protected-Movement-Allowed`; it does not guess yellow from remaining duration or infer pedestrian color from vehicle color.

Tests are a dependency-free Kotlin main in `src/test/kotlin/kr/signal/drive/core/CoreTestMain.kt`. Root project tooling compiles this with main sources and runs `kr.signal.drive.core.CoreTestMainKt`.
