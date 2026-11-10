package kr.signal.drive.core

/** Detects wall-clock jumps without relying on Android APIs. Supply elapsedRealtime() on Android. */
class ClockGuard(private val maxDriftMs: Long = 1_000L) {
    init { require(maxDriftMs >= 0L) }

    private var lastWallTimeMs: Long? = null
    private var lastElapsedRealtimeMs: Long? = null
    private var valid = true

    @Synchronized
    fun checkpoint(wallTimeMs: Long, elapsedRealtimeMs: Long): Boolean {
        if (!valid) return false
        if (wallTimeMs <= 0L || elapsedRealtimeMs < 0L) {
            valid = false
            return false
        }
        val wallBefore = lastWallTimeMs
        val elapsedBefore = lastElapsedRealtimeMs
        if (wallBefore != null && elapsedBefore != null) {
            if (wallTimeMs < wallBefore || elapsedRealtimeMs < elapsedBefore) {
                valid = false
                return false
            }
            val wallDelta = wallTimeMs - wallBefore
            val elapsedDelta = elapsedRealtimeMs - elapsedBefore
            val drift = if (wallDelta >= elapsedDelta) wallDelta - elapsedDelta else elapsedDelta - wallDelta
            if (drift > maxDriftMs) {
                valid = false
                return false
            }
        }
        lastWallTimeMs = wallTimeMs
        lastElapsedRealtimeMs = elapsedRealtimeMs
        return true
    }

    @Synchronized
    fun reset() {
        lastWallTimeMs = null
        lastElapsedRealtimeMs = null
        valid = true
    }
}
