package kr.signal.drive.core

/**
 * Session clock for signal expiry. Supply elapsedRealtime() on Android.
 *
 * Large clock jumps invalidate the session. Smaller backwards corrections can happen between two
 * increasing wall samples, so a valid reading also advances at least as far as monotonic time.
 * Never evaluate an existing packet using raw wall time after obtaining a trusted reading.
 */
class ClockGuard(private val maxDriftMs: Long = 1_000L) {
    init { require(maxDriftMs >= 0L) }

    private var lastWallTimeMs: Long? = null
    private var lastElapsedRealtimeMs: Long? = null
    private var lastEvaluationTimeMs: Long? = null
    private var valid = true

    /** Compatibility API for callers that only need jump detection. */
    @Synchronized
    fun checkpoint(wallTimeMs: Long, elapsedRealtimeMs: Long): Boolean =
        evaluationTimeMs(wallTimeMs, elapsedRealtimeMs) != null

    /**
     * Returns a trusted epoch time for TrustEngine, or null until reset after invalidation.
     *
     * The monotonic floor belongs to the entire session, including render/network callbacks. A
     * small correction cannot buy an old packet extra freshness or resurrect its expired countdown.
     */
    @Synchronized
    fun evaluationTimeMs(wallTimeMs: Long, elapsedRealtimeMs: Long): Long? {
        if (!valid) return null
        if (wallTimeMs <= 0L || elapsedRealtimeMs < 0L) {
            valid = false
            return null
        }
        val wallBefore = lastWallTimeMs
        val elapsedBefore = lastElapsedRealtimeMs
        val evaluationBefore = lastEvaluationTimeMs
        var evaluationTime = wallTimeMs
        if (wallBefore != null && elapsedBefore != null) {
            if (wallTimeMs < wallBefore || elapsedRealtimeMs < elapsedBefore) {
                valid = false
                return null
            }
            val wallDelta = wallTimeMs - wallBefore
            val elapsedDelta = elapsedRealtimeMs - elapsedBefore
            val drift = if (wallDelta >= elapsedDelta) wallDelta - elapsedDelta else elapsedDelta - wallDelta
            if (drift > maxDriftMs) {
                valid = false
                return null
            }
            if (evaluationBefore == null || evaluationBefore > Long.MAX_VALUE - elapsedDelta) {
                valid = false
                return null
            }
            evaluationTime = maxOf(wallTimeMs, evaluationBefore + elapsedDelta)
        }
        lastWallTimeMs = wallTimeMs
        lastElapsedRealtimeMs = elapsedRealtimeMs
        lastEvaluationTimeMs = evaluationTime
        return evaluationTime
    }

    @Synchronized
    fun reset() {
        lastWallTimeMs = null
        lastElapsedRealtimeMs = null
        lastEvaluationTimeMs = null
        valid = true
    }
}
