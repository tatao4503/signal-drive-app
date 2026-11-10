package kr.signal.drive.core

/** Platform restrictions are independent from traffic-data trust. */
enum class VehicleUxState { UNKNOWN, RESTRICTED, UNRESTRICTED }

data class VehicleUxDecision(
    val state: VehicleUxState,
    val canOpenSettings: Boolean,
    val canChangeTarget: Boolean,
    val canRunDemonstration: Boolean,
    val canUseTextInput: Boolean,
    val messageKo: String,
)

object VehicleUxPolicy {
    fun evaluate(state: VehicleUxState): VehicleUxDecision {
        val unrestricted = state == VehicleUxState.UNRESTRICTED
        return VehicleUxDecision(
            state = state,
            canOpenSettings = unrestricted,
            canChangeTarget = unrestricted,
            canRunDemonstration = unrestricted,
            canUseTextInput = unrestricted,
            messageKo = when (state) {
                VehicleUxState.UNKNOWN -> "차량 제한 상태 미확인 · 설정과 시연을 잠급니다"
                VehicleUxState.RESTRICTED -> "주행 제한 적용 · 설정과 시연을 잠급니다"
                VehicleUxState.UNRESTRICTED -> "차량 플랫폼에서 제한 없음이 확인되었습니다"
            },
        )
    }
}
