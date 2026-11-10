package kr.signal.drive.core

/** Direction identifies the controller approach, never the nearest map point alone. */
enum class Approach(val apiPrefix: String) {
    N("nt"), NE("ne"), E("et"), SE("se"), S("st"), SW("sw"), W("wt"), NW("nw");

    companion object {
        fun fromWire(value: String?): Approach? = entries.firstOrNull { it.name.equals(value, ignoreCase = true) }
    }
}

enum class Movement(val apiToken: String) {
    STRAIGHT("Stsg"), LEFT("Ltsg"), UTURN("Utsg"), PEDESTRIAN("Pdsg"), BUS("Bssg"), BICYCLE("Bcsg");

    companion object {
        fun fromWire(value: String?): Movement? = entries.firstOrNull { it.name.equals(value, ignoreCase = true) }
    }
}

enum class SignalPhase {
    RED, YELLOW, GREEN, UNKNOWN, FLASHING_RED, FLASHING_YELLOW, DARK;

    val isSupportedDisplayPhase: Boolean get() = this == RED || this == YELLOW || this == GREEN

    companion object {
        fun fromWire(value: String?): SignalPhase = entries.firstOrNull { it.name == value } ?: UNKNOWN

        /** Only explicit reviewed source states are normalized. Timing alone never selects a color. */
        fun fromOfficialState(value: String?): SignalPhase = when (value) {
            "stop-And-Remain" -> RED
            "protected-Movement-Allowed" -> GREEN
            else -> UNKNOWN
        }
    }
}

enum class Provenance(val sourceLabel: String) {
    LIVE("실시간 데이터"), SIMULATION("시뮬레이션 · 실제 신호 아님"), REPLAY("기록 재생 · 현재 신호 아님");

    companion object {
        fun fromWire(value: String?): Provenance? = entries.firstOrNull { it.name.equals(value, ignoreCase = true) }
    }
}

/** Selected by a target resolver, not automatically by geometric proximity. */
data class SignalTarget(
    val intersectionId: String,
    val approach: Approach?,
    val movement: Movement?,
    val mappingId: String? = null,
    val mappingVersion: String? = null,
)

/** Packet DTO. Verification is intentionally absent; only the trusted registry grants it. */
data class SignalObservation(
    val intersectionId: String,
    val approach: Approach?,
    val movement: Movement?,
    val phase: SignalPhase,
    val provenance: Provenance,
    val sourceTimestampEpochMs: Long?,
    val remainingDeciseconds: Long?,
    val mappingId: String? = null,
    val mappingVersion: String? = null,
)

enum class MappingVerification { UNVERIFIED, VERIFIED, RETIRED }

/** Authoritative reviewed config. This must not be deserialized from untrusted packet input. */
data class MovementMapping(
    val id: String,
    val version: String,
    val intersectionId: String,
    val approach: Approach,
    val movement: Movement,
    val verification: MappingVerification = MappingVerification.UNVERIFIED,
    val evidenceReference: String? = null,
)

enum class DisplayMode { LIVE_ONLY, DEMONSTRATION }
enum class DisplayKind { VERIFIED_LIVE, DEMONSTRATION, UNKNOWN }

enum class TrustReason(val code: String, val messageKo: String) {
    VERIFIED("verified", "검증된 대상의 최신 신호 데이터입니다"),
    DEMONSTRATION("demonstration", "시연용 데이터입니다 · 실제 신호를 나타내지 않습니다"),
    TARGET_NOT_SELECTED("target-not-selected", "대상 교차로가 선택되지 않았습니다"),
    INVALID_TARGET("invalid-target", "대상 교차로 정보를 확인할 수 없습니다"),
    UNKNOWN_APPROACH("unknown-approach", "진입 방향을 확인할 수 없습니다"),
    UNKNOWN_MOVEMENT("unknown-movement", "대상 이동 방향을 확인할 수 없습니다"),
    NO_DATA("no-data", "현재 신호 데이터를 확인할 수 없습니다"),
    ID_MISMATCH("id-mismatch", "선택한 교차로와 수신 데이터가 다릅니다"),
    APPROACH_MISMATCH("approach-mismatch", "진입 방향과 수신 신호 방향이 다릅니다"),
    MOVEMENT_MISMATCH("movement-mismatch", "대상 이동과 수신 신호가 다릅니다"),
    SOURCE_MODE_MISMATCH("source-mode-mismatch", "현재 모드에서 사용할 수 없는 데이터입니다"),
    MAPPING_UNVERIFIED("mapping-unverified", "교차로와 진행 방향 연결이 검증되지 않았습니다"),
    MAPPING_ID_MISMATCH("mapping-id-mismatch", "수신 데이터의 연결 식별자가 다릅니다"),
    MAPPING_VERSION_MISMATCH("mapping-version-mismatch", "검증된 연결 버전과 수신 버전이 다릅니다"),
    AMBIGUOUS_MAPPING("ambiguous-mapping", "검증된 연결을 하나로 확정할 수 없습니다"),
    CLOCK_INVALID("clock-invalid", "시각을 신뢰할 수 없어 최신 신호를 표시하지 않습니다"),
    MISSING_TIMESTAMP("missing-timestamp", "원천 전송 시각이 없습니다"),
    FUTURE_TIMESTAMP("future-timestamp", "원천 전송 시각이 현재보다 미래입니다"),
    STALE("stale", "원천 데이터가 허용 갱신 시간을 넘었습니다"),
    UNSUPPORTED_PHASE("unsupported-phase", "명확한 신호 상태를 확인할 수 없습니다"),
    MISSING_REMAINING("missing-remaining", "신호 잔여시간이 없습니다"),
    INVALID_REMAINING("invalid-remaining", "신호 잔여시간이 유효하지 않습니다"),
    EXPIRED("expired", "수신한 신호의 유효시간이 끝났습니다"),
}

data class DisplayDecision internal constructor(
    val kind: DisplayKind,
    val reason: TrustReason,
    val phase: SignalPhase?,
    val remainingSeconds: Long?,
    val sourceLabel: String,
    val sourceTimestampEpochMs: Long?,
    val expiresAtEpochMs: Long?,
) {
    val canShowSignal: Boolean get() = kind != DisplayKind.UNKNOWN && phase != null && remainingSeconds != null
    val isDemonstration: Boolean get() = kind == DisplayKind.DEMONSTRATION

    /** v0.1 is status display only. No operational notification or driving instruction is authorized. */
    val canNotifyState: Boolean get() = false
}
