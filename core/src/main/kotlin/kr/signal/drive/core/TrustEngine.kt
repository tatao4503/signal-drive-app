package kr.signal.drive.core

data class TrustPolicy(
    val maxSourceAgeMs: Long = 3_000L,
    val maxFutureSkewMs: Long = 0L,
    val maxRemainingDeciseconds: Long = 36_000L,
) {
    init {
        require(maxSourceAgeMs > 0L) { "maxSourceAgeMs must be positive" }
        require(maxFutureSkewMs >= 0L) { "maxFutureSkewMs must be nonnegative" }
        require(maxRemainingDeciseconds in 1L..(Long.MAX_VALUE / 100L)) { "remaining limit is invalid" }
    }
}

class TrustEngine(
    private val policy: TrustPolicy = TrustPolicy(),
    approvedMappings: List<MovementMapping> = emptyList(),
) {
    private val registry = approvedMappings.toList()

    fun evaluate(
        target: SignalTarget?,
        observation: SignalObservation?,
        nowEpochMs: Long,
        displayMode: DisplayMode = DisplayMode.LIVE_ONLY,
    ): DisplayDecision {
        fun unknown(reason: TrustReason) = DisplayDecision(
            kind = DisplayKind.UNKNOWN,
            reason = reason,
            phase = null,
            remainingSeconds = null,
            sourceLabel = observation?.provenance?.sourceLabel ?: "현재 신호 확인 불가",
            sourceTimestampEpochMs = observation?.sourceTimestampEpochMs,
            expiresAtEpochMs = null,
        )

        if (nowEpochMs <= 0L) return unknown(TrustReason.CLOCK_INVALID)
        if (target == null) return unknown(TrustReason.TARGET_NOT_SELECTED)
        if (target.intersectionId.isBlank()) return unknown(TrustReason.INVALID_TARGET)
        if (target.approach == null) return unknown(TrustReason.UNKNOWN_APPROACH)
        if (target.movement == null) return unknown(TrustReason.UNKNOWN_MOVEMENT)
        if (observation == null) return unknown(TrustReason.NO_DATA)
        if (observation.intersectionId != target.intersectionId) return unknown(TrustReason.ID_MISMATCH)
        if (observation.approach == null) return unknown(TrustReason.UNKNOWN_APPROACH)
        if (observation.movement == null) return unknown(TrustReason.UNKNOWN_MOVEMENT)
        if (observation.approach != target.approach) return unknown(TrustReason.APPROACH_MISMATCH)
        if (observation.movement != target.movement) return unknown(TrustReason.MOVEMENT_MISMATCH)

        when (displayMode) {
            DisplayMode.LIVE_ONLY -> {
                if (observation.provenance != Provenance.LIVE) return unknown(TrustReason.SOURCE_MODE_MISMATCH)
                if (target.mappingId.isNullOrBlank() || target.mappingVersion.isNullOrBlank()) {
                    return unknown(TrustReason.MAPPING_UNVERIFIED)
                }
                if (observation.mappingId != target.mappingId) return unknown(TrustReason.MAPPING_ID_MISMATCH)
                if (observation.mappingVersion != target.mappingVersion) return unknown(TrustReason.MAPPING_VERSION_MISMATCH)
                val mappings = registry.filter { it.id == target.mappingId && it.version == target.mappingVersion }
                if (mappings.size > 1) return unknown(TrustReason.AMBIGUOUS_MAPPING)
                val mapping = mappings.singleOrNull() ?: return unknown(TrustReason.MAPPING_UNVERIFIED)
                if (mapping.verification != MappingVerification.VERIFIED || mapping.evidenceReference.isNullOrBlank()) {
                    return unknown(TrustReason.MAPPING_UNVERIFIED)
                }
                if (mapping.intersectionId != target.intersectionId || mapping.approach != target.approach || mapping.movement != target.movement) {
                    return unknown(TrustReason.MAPPING_UNVERIFIED)
                }
            }
            DisplayMode.DEMONSTRATION -> {
                if (observation.provenance == Provenance.LIVE) return unknown(TrustReason.SOURCE_MODE_MISMATCH)
            }
        }

        val sourceTime = observation.sourceTimestampEpochMs
        if (sourceTime == null || sourceTime <= 0L) return unknown(TrustReason.MISSING_TIMESTAMP)
        if (sourceTime > nowEpochMs && sourceTime - nowEpochMs > policy.maxFutureSkewMs) {
            return unknown(TrustReason.FUTURE_TIMESTAMP)
        }
        // Small explicitly configured clock skew does not add extra time to the displayed countdown.
        val effectiveSourceTime = minOf(sourceTime, nowEpochMs)
        if (nowEpochMs - effectiveSourceTime >= policy.maxSourceAgeMs) return unknown(TrustReason.STALE)
        if (!observation.phase.isSupportedDisplayPhase) return unknown(TrustReason.UNSUPPORTED_PHASE)

        val remaining = observation.remainingDeciseconds ?: return unknown(TrustReason.MISSING_REMAINING)
        if (remaining <= 0L || remaining > policy.maxRemainingDeciseconds) return unknown(TrustReason.INVALID_REMAINING)
        val durationMs = remaining * 100L
        if (effectiveSourceTime > Long.MAX_VALUE - durationMs) return unknown(TrustReason.CLOCK_INVALID)
        val expiresAt = effectiveSourceTime + durationMs
        val remainingMs = expiresAt - nowEpochMs
        if (remainingMs <= 0L) return unknown(TrustReason.EXPIRED)

        val demonstration = displayMode == DisplayMode.DEMONSTRATION
        return DisplayDecision(
            kind = if (demonstration) DisplayKind.DEMONSTRATION else DisplayKind.VERIFIED_LIVE,
            reason = if (demonstration) TrustReason.DEMONSTRATION else TrustReason.VERIFIED,
            phase = observation.phase,
            remainingSeconds = ((remainingMs - 1L) / 1_000L) + 1L,
            sourceLabel = observation.provenance.sourceLabel,
            sourceTimestampEpochMs = sourceTime,
            expiresAtEpochMs = expiresAt,
        )
    }
}
