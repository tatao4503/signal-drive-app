package kr.signal.drive.core

private const val NOW = 1_793_836_800_000L

private val selected = SignalTarget("20386", Approach.SE, Movement.STRAIGHT, "reviewed-se-straight", "v1")
private val mapping = MovementMapping(
    id = "reviewed-se-straight",
    version = "v1",
    intersectionId = "20386",
    approach = Approach.SE,
    movement = Movement.STRAIGHT,
    verification = MappingVerification.VERIFIED,
    evidenceReference = "test-fixture-only:not-a-field-verification",
)

private fun packet(
    sourceTimestampEpochMs: Long? = NOW,
    remainingDeciseconds: Long? = 150,
    phase: SignalPhase = SignalPhase.RED,
    provenance: Provenance = Provenance.LIVE,
) = SignalObservation(
    intersectionId = "20386",
    approach = Approach.SE,
    movement = Movement.STRAIGHT,
    phase = phase,
    provenance = provenance,
    sourceTimestampEpochMs = sourceTimestampEpochMs,
    remainingDeciseconds = remainingDeciseconds,
    mappingId = "reviewed-se-straight",
    mappingVersion = "v1",
)

private fun engine(vararg mappings: MovementMapping = arrayOf(mapping)) = TrustEngine(approvedMappings = mappings.toList())

private fun assertUnknown(decision: DisplayDecision, reason: TrustReason) {
    check(decision.kind == DisplayKind.UNKNOWN) { "Expected UNKNOWN, got $decision" }
    check(decision.reason == reason) { "Expected $reason, got ${decision.reason}" }
    check(decision.phase == null && decision.remainingSeconds == null && decision.expiresAtEpochMs == null) {
        "Unknown data must have no color, countdown or expiry: $decision"
    }
    check(!decision.canShowSignal && !decision.canNotifyState)
}

/** No test framework dependency: compile with main sources and execute this entry point. */
fun main() {
    var passed = 0
    var failed = 0
    fun test(name: String, action: () -> Unit) {
        try {
            action()
            passed += 1
            println("PASS $name")
        } catch (error: Throwable) {
            failed += 1
            System.err.println("FAIL $name: ${error.message}")
        }
    }

    test("a reviewed exact target displays explicit RED") {
        val d = engine().evaluate(selected, packet(), NOW)
        check(d.kind == DisplayKind.VERIFIED_LIVE && d.phase == SignalPhase.RED && d.remainingSeconds == 15L)
        check(d.expiresAtEpochMs == NOW + 15_000L)
        check(d.canShowSignal && !d.canNotifyState && !d.isDemonstration)
    }
    test("an empty registry cannot display any live signal") {
        assertUnknown(TrustEngine().evaluate(selected, packet(), NOW), TrustReason.MAPPING_UNVERIFIED)
    }
    test("no selected target suppresses all color and numbers") {
        assertUnknown(engine().evaluate(null, packet(), NOW), TrustReason.TARGET_NOT_SELECTED)
    }
    test("blank intersection target is not meaningful") {
        assertUnknown(engine().evaluate(selected.copy(intersectionId = " "), packet(), NOW), TrustReason.INVALID_TARGET)
    }
    test("an unresolved approach suppresses display") {
        assertUnknown(engine().evaluate(selected.copy(approach = null), packet(), NOW), TrustReason.UNKNOWN_APPROACH)
    }
    test("an unresolved movement suppresses display") {
        assertUnknown(engine().evaluate(selected.copy(movement = null), packet(), NOW), TrustReason.UNKNOWN_MOVEMENT)
    }
    test("a missing packet suppresses display") {
        assertUnknown(engine().evaluate(selected, null, NOW), TrustReason.NO_DATA)
    }
    test("another intersection cannot borrow this mapping") {
        assertUnknown(engine().evaluate(selected, packet().copy(intersectionId = "99999"), NOW), TrustReason.ID_MISMATCH)
    }
    test("another approach cannot borrow this mapping") {
        assertUnknown(engine().evaluate(selected, packet().copy(approach = Approach.NW), NOW), TrustReason.APPROACH_MISMATCH)
    }
    test("another movement cannot borrow this mapping") {
        assertUnknown(engine().evaluate(selected, packet().copy(movement = Movement.PEDESTRIAN), NOW), TrustReason.MOVEMENT_MISMATCH)
    }
    test("missing source approach is rejected") {
        assertUnknown(engine().evaluate(selected, packet().copy(approach = null), NOW), TrustReason.UNKNOWN_APPROACH)
    }
    test("missing source movement is rejected") {
        assertUnknown(engine().evaluate(selected, packet().copy(movement = null), NOW), TrustReason.UNKNOWN_MOVEMENT)
    }
    test("an unverified registry entry is never promoted") {
        val e = engine(mapping.copy(verification = MappingVerification.UNVERIFIED))
        assertUnknown(e.evaluate(selected, packet(), NOW), TrustReason.MAPPING_UNVERIFIED)
    }
    test("a retired registry entry is not authoritative") {
        val e = engine(mapping.copy(verification = MappingVerification.RETIRED))
        assertUnknown(e.evaluate(selected, packet(), NOW), TrustReason.MAPPING_UNVERIFIED)
    }
    test("a verified label without evidence reference cannot authorize display") {
        val e = engine(mapping.copy(evidenceReference = " "))
        assertUnknown(e.evaluate(selected, packet(), NOW), TrustReason.MAPPING_UNVERIFIED)
    }
    test("packet mapping id must match target mapping id") {
        assertUnknown(engine().evaluate(selected, packet().copy(mappingId = "other"), NOW), TrustReason.MAPPING_ID_MISMATCH)
    }
    test("packet mapping version must match the reviewed version") {
        assertUnknown(engine().evaluate(selected, packet().copy(mappingVersion = "v2"), NOW), TrustReason.MAPPING_VERSION_MISMATCH)
    }
    test("a reviewed identity cannot be changed through target id reuse") {
        val wrong = mapping.copy(approach = Approach.N)
        assertUnknown(engine(wrong).evaluate(selected, packet(), NOW), TrustReason.MAPPING_UNVERIFIED)
    }
    test("duplicate registry authority is ambiguous and fails closed") {
        assertUnknown(engine(mapping, mapping).evaluate(selected, packet(), NOW), TrustReason.AMBIGUOUS_MAPPING)
    }
    test("the registry is copied rather than retaining a mutable caller list") {
        val mutable = mutableListOf(mapping)
        val e = TrustEngine(approvedMappings = mutable)
        mutable.clear()
        check(e.evaluate(selected, packet(), NOW).kind == DisplayKind.VERIFIED_LIVE)
    }
    test("null source timestamp is not fresh") {
        assertUnknown(engine().evaluate(selected, packet(sourceTimestampEpochMs = null), NOW), TrustReason.MISSING_TIMESTAMP)
    }
    test("zero or negative source timestamps are invalid") {
        listOf(0L, -1L).forEach {
            assertUnknown(engine().evaluate(selected, packet(sourceTimestampEpochMs = it), NOW), TrustReason.MISSING_TIMESTAMP)
        }
    }
    test("even a 1 ms future timestamp is rejected by default") {
        assertUnknown(engine().evaluate(selected, packet(sourceTimestampEpochMs = NOW + 1L), NOW), TrustReason.FUTURE_TIMESTAMP)
    }
    test("freshness ends at the exact configured boundary") {
        assertUnknown(engine().evaluate(selected, packet(sourceTimestampEpochMs = NOW - 3_000L), NOW), TrustReason.STALE)
        check(engine().evaluate(selected, packet(sourceTimestampEpochMs = NOW - 2_999L), NOW).canShowSignal)
    }
    test("source age is subtracted rather than restarting received remaining time") {
        val e = TrustEngine(TrustPolicy(maxSourceAgeMs = 30_000L), listOf(mapping))
        val d = e.evaluate(selected, packet(NOW - 20_000L, 300L), NOW)
        check(d.remainingSeconds == 10L && d.expiresAtEpochMs == NOW + 10_000L)
    }
    test("countdown follows elapsed wall time rather than callback count") {
        val e = engine()
        val p = packet(remainingDeciseconds = 120L)
        check(e.evaluate(selected, p, NOW).remainingSeconds == 12L)
        check(e.evaluate(selected, p, NOW + 2_700L).remainingSeconds == 10L)
    }
    test("a packet expiration cannot synthesize the next signal color") {
        val p = packet(NOW - 500L, 5L, SignalPhase.GREEN)
        assertUnknown(engine().evaluate(selected, p, NOW), TrustReason.EXPIRED)
    }
    test("one remaining millisecond rounds to one display second") {
        val d = engine().evaluate(selected, packet(NOW - 499L, 5L), NOW)
        check(d.remainingSeconds == 1L && d.phase == SignalPhase.RED)
    }
    test("null remaining duration is unknown") {
        assertUnknown(engine().evaluate(selected, packet(remainingDeciseconds = null), NOW), TrustReason.MISSING_REMAINING)
    }
    test("negative zero and excessive remaining durations are rejected") {
        listOf(-1L, 0L, 36_001L, Long.MAX_VALUE).forEach {
            assertUnknown(engine().evaluate(selected, packet(remainingDeciseconds = it), NOW), TrustReason.INVALID_REMAINING)
        }
    }
    test("explicit RED does not become GREEN for a pedestrian") {
        val pedestrianTarget = selected.copy(movement = Movement.PEDESTRIAN)
        val pedestrianMapping = mapping.copy(movement = Movement.PEDESTRIAN)
        val p = packet().copy(movement = Movement.PEDESTRIAN)
        check(engine(pedestrianMapping).evaluate(pedestrianTarget, p, NOW).phase == SignalPhase.RED)
    }
    test("short GREEN remains GREEN rather than guessed YELLOW") {
        val d = engine().evaluate(selected, packet(remainingDeciseconds = 20L, phase = SignalPhase.GREEN), NOW)
        check(d.phase == SignalPhase.GREEN && d.remainingSeconds == 2L)
    }
    test("unknown flashing and dark states never produce a solid color") {
        listOf(SignalPhase.UNKNOWN, SignalPhase.FLASHING_RED, SignalPhase.FLASHING_YELLOW, SignalPhase.DARK).forEach {
            assertUnknown(engine().evaluate(selected, packet(phase = it), NOW), TrustReason.UNSUPPORTED_PHASE)
        }
    }
    test("all eight distinct approaches can be selected without collapsing values") {
        Approach.entries.forEach { direction ->
            val target = selected.copy(approach = direction)
            val approved = mapping.copy(approach = direction)
            val p = packet().copy(approach = direction)
            check(engine(approved).evaluate(target, p, NOW).kind == DisplayKind.VERIFIED_LIVE)
        }
    }
    test("only two reviewed official state names normalize to colors") {
        check(SignalPhase.fromOfficialState("stop-And-Remain") == SignalPhase.RED)
        check(SignalPhase.fromOfficialState("protected-Movement-Allowed") == SignalPhase.GREEN)
        listOf(null, "", "permissive-Movement-Allowed", "protected-clearance", "GREEN", "3").forEach {
            check(SignalPhase.fromOfficialState(it) == SignalPhase.UNKNOWN)
        }
    }
    test("SIMULATION never enters LIVE_ONLY even with a verified mapping") {
        assertUnknown(engine().evaluate(selected, packet(provenance = Provenance.SIMULATION), NOW), TrustReason.SOURCE_MODE_MISMATCH)
    }
    test("REPLAY never enters LIVE_ONLY") {
        assertUnknown(engine().evaluate(selected, packet(provenance = Provenance.REPLAY), NOW), TrustReason.SOURCE_MODE_MISMATCH)
    }
    test("explicit demonstration works with an empty live mapping registry") {
        val d = TrustEngine().evaluate(selected, packet(provenance = Provenance.SIMULATION), NOW, DisplayMode.DEMONSTRATION)
        check(d.kind == DisplayKind.DEMONSTRATION && d.isDemonstration && d.canShowSignal)
        check(d.sourceLabel.contains("시뮬레이션") && !d.canNotifyState)
    }
    test("replay is permanently marked as non-current data") {
        val d = engine().evaluate(selected, packet(provenance = Provenance.REPLAY), NOW, DisplayMode.DEMONSTRATION)
        check(d.kind == DisplayKind.DEMONSTRATION && d.sourceLabel.contains("현재 신호 아님"))
    }
    test("live observations cannot be quietly relabeled as demonstrations") {
        assertUnknown(engine().evaluate(selected, packet(), NOW, DisplayMode.DEMONSTRATION), TrustReason.SOURCE_MODE_MISMATCH)
    }
    test("demonstrations retain exact target and freshness guards") {
        val p = packet(provenance = Provenance.SIMULATION).copy(approach = Approach.N)
        assertUnknown(TrustEngine().evaluate(selected, p, NOW, DisplayMode.DEMONSTRATION), TrustReason.APPROACH_MISMATCH)
        val old = packet(NOW - 3_000L, provenance = Provenance.SIMULATION)
        assertUnknown(TrustEngine().evaluate(selected, old, NOW, DisplayMode.DEMONSTRATION), TrustReason.STALE)
    }
    test("invalid clock and timestamp overflow fail closed") {
        assertUnknown(engine().evaluate(selected, packet(), 0L), TrustReason.CLOCK_INVALID)
        val huge = Long.MAX_VALUE - 10L
        assertUnknown(engine().evaluate(selected, packet(huge, 10L), huge), TrustReason.CLOCK_INVALID)
    }
    test("configured future skew never extends the duration") {
        val e = TrustEngine(TrustPolicy(maxFutureSkewMs = 500L), listOf(mapping))
        val d = e.evaluate(selected, packet(NOW + 100L, 100L), NOW)
        check(d.expiresAtEpochMs == NOW + 10_000L && d.remainingSeconds == 10L)
    }
    test("invalid policies cannot be instantiated") {
        listOf<() -> Unit>(
            { TrustPolicy(maxSourceAgeMs = 0) },
            { TrustPolicy(maxFutureSkewMs = -1) },
            { TrustPolicy(maxRemainingDeciseconds = Long.MAX_VALUE) },
        ).forEach { construct ->
            var rejected = false
            try { construct() } catch (_: IllegalArgumentException) { rejected = true }
            check(rejected)
        }
    }
    test("UNKNOWN vehicle restrictions lock interaction") {
        val ux = VehicleUxPolicy.evaluate(VehicleUxState.UNKNOWN)
        check(!ux.canOpenSettings && !ux.canChangeTarget && !ux.canRunDemonstration && !ux.canUseTextInput)
    }
    test("RESTRICTED vehicle state locks interaction") {
        val ux = VehicleUxPolicy.evaluate(VehicleUxState.RESTRICTED)
        check(!ux.canOpenSettings && !ux.canChangeTarget && !ux.canRunDemonstration && !ux.canUseTextInput)
    }
    test("UNRESTRICTED vehicle state allows parked interaction only") {
        val ux = VehicleUxPolicy.evaluate(VehicleUxState.UNRESTRICTED)
        check(ux.canOpenSettings && ux.canChangeTarget && ux.canRunDemonstration && ux.canUseTextInput)
    }
    test("wall clock jumps latch invalid until an explicit reset") {
        val clock = ClockGuard()
        check(clock.checkpoint(NOW, 10_000L))
        check(clock.checkpoint(NOW + 1_000L, 11_000L))
        check(!clock.checkpoint(NOW + 61_000L, 12_000L))
        check(!clock.checkpoint(NOW + 62_000L, 13_000L))
        clock.reset()
        check(clock.checkpoint(NOW + 62_000L, 13_000L))
    }
    test("backwards wall time or monotonic time is invalid") {
        val clock = ClockGuard()
        check(clock.checkpoint(NOW, 1_000L))
        check(!clock.checkpoint(NOW - 1L, 2_000L))
        clock.reset()
        check(clock.checkpoint(NOW, 1_000L))
        check(!clock.checkpoint(NOW + 1L, 999L))
    }
    test("normal delayed callbacks and long pauses do not look like clock jumps") {
        val clock = ClockGuard()
        check(clock.checkpoint(NOW, 1_000L))
        check(clock.checkpoint(NOW + 60_000L, 61_000L))
        assertUnknown(engine().evaluate(selected, packet(), NOW + 60_000L), TrustReason.STALE)
    }
    test("a sub-tick wall correction cannot reduce trusted source age") {
        val clock = ClockGuard()
        check(clock.evaluationTimeMs(NOW, 0L) == NOW)
        check(clock.evaluationTimeMs(NOW + 200L, 200L) == NOW + 200L)
        // Wall time still increases, but a 150 ms correction hid part of the real elapsed time.
        check(clock.evaluationTimeMs(NOW + 250L, 400L) == NOW + 400L)
    }
    test("cumulative small corrections cannot extend the freshness window") {
        val clock = ClockGuard()
        val p = packet()
        check(clock.evaluationTimeMs(NOW, 0L) == NOW)
        var evaluationTime = NOW
        for (tick in 1L..16L) {
            evaluationTime = checkNotNull(clock.evaluationTimeMs(NOW + tick * 50L, tick * 200L))
            check(evaluationTime == NOW + tick * 200L)
        }
        // Raw wall age is only 800 ms, but 3.2 seconds really passed.
        assertUnknown(engine().evaluate(selected, p, evaluationTime), TrustReason.STALE)
    }
    test("an expired packet cannot be resurrected by repeated small clock corrections") {
        val clock = ClockGuard()
        val p = packet(remainingDeciseconds = 10L)
        check(clock.evaluationTimeMs(NOW, 0L) == NOW)
        for (tick in 1L..4L) {
            val now = checkNotNull(clock.evaluationTimeMs(NOW + tick * 50L, tick * 200L))
            check(engine().evaluate(selected, p, now).canShowSignal)
        }
        for (tick in 5L..8L) {
            val now = checkNotNull(clock.evaluationTimeMs(NOW + tick * 50L, tick * 200L))
            assertUnknown(engine().evaluate(selected, p, now), TrustReason.EXPIRED)
        }
    }
    test("a small forward correction cannot freeze subsequent trusted time") {
        val clock = ClockGuard()
        check(clock.evaluationTimeMs(NOW, 0L) == NOW)
        check(clock.evaluationTimeMs(NOW + 350L, 200L) == NOW + 350L)
        check(clock.evaluationTimeMs(NOW + 400L, 400L) == NOW + 550L)
        check(clock.evaluationTimeMs(NOW + 600L, 600L) == NOW + 750L)
    }
    test("compatibility checkpoints share the same monotonic evaluation floor") {
        val clock = ClockGuard()
        check(clock.checkpoint(NOW, 0L))
        check(clock.checkpoint(NOW + 200L, 200L))
        check(clock.evaluationTimeMs(NOW + 250L, 400L) == NOW + 400L)
        check(clock.checkpoint(NOW + 300L, 600L))
        check(clock.evaluationTimeMs(NOW + 300L, 600L) == NOW + 600L)
    }
    test("trusted time stays invalid after a jump until explicit session reset") {
        val clock = ClockGuard()
        check(clock.evaluationTimeMs(NOW, 0L) == NOW)
        check(clock.evaluationTimeMs(NOW + 10_000L, 1L) == null)
        check(clock.evaluationTimeMs(NOW + 10_001L, 2L) == null)
        check(!clock.checkpoint(NOW + 10_002L, 3L))
        clock.reset()
        check(clock.evaluationTimeMs(NOW + 10_002L, 3L) == NOW + 10_002L)
    }
    test("reset clears the previous session floor for a new packet") {
        val clock = ClockGuard()
        clock.evaluationTimeMs(NOW, 0L)
        check(clock.evaluationTimeMs(NOW + 50L, 200L) == NOW + 200L)
        clock.reset()
        val now = checkNotNull(clock.evaluationTimeMs(NOW + 50L, 200L))
        check(now == NOW + 50L)
        // Lifecycle/transport code must clear the old packet when resetting the clock.
        check(engine().evaluate(selected, packet(sourceTimestampEpochMs = now), now).canShowSignal)
    }
    test("trusted time overflow invalidates instead of wrapping the age floor") {
        val clock = ClockGuard()
        val nearLimit = Long.MAX_VALUE - 20L
        check(clock.evaluationTimeMs(nearLimit, 0L) == nearLimit)
        check(clock.evaluationTimeMs(nearLimit + 10L, 100L) == null)
        check(clock.evaluationTimeMs(nearLimit + 11L, 101L) == null)
    }
    test("wire enum parsing preserves eight directions and known movement") {
        Approach.entries.forEach { check(Approach.fromWire(it.name) == it && Approach.fromWire(it.name.lowercase()) == it) }
        check(Approach.fromWire("nearest") == null)
        check(Movement.fromWire("STRAIGHT") == Movement.STRAIGHT)
        check(Movement.fromWire("pedestrian") == Movement.PEDESTRIAN)
        check(Movement.fromWire("forward") == null)
    }

    println("CORE TESTS: $passed passed, $failed failed")
    check(failed == 0) { "$failed core tests failed" }
}
