package kr.signal.drive

import android.car.Car
import android.car.drivingstate.CarUxRestrictions
import android.car.drivingstate.CarUxRestrictionsManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import kr.signal.drive.core.VehicleUxState

/**
 * AAOS 차량 제한 상태(CarUxRestrictions)를 읽는다. 공개 Car API를 직접 쓴다(`useLibrary("android.car")`).
 *
 * - 일반 Android에는 android.car가 없으므로 Car 클래스는 [CarConnection] 안에서만, Automotive일 때만 쓴다.
 * - 확인할 수 없으면 항상 UNKNOWN(fail-closed).
 * - 세션 번호와 manager 동일성으로, 끊긴 연결·이전 리스너의 늦은 콜백을 버린다.
 */
class CarRestrictionsAdapter(
    private val context: Context,
    private val onChanged: (VehicleUxState, Int?, String) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private var connection: CarConnection? = null
    private var active = false
    private var session = 0L
    private fun current(expected: Long) = active && session == expected

    fun start() {
        if (active) return
        active = true
        val expected = ++session
        onChanged(VehicleUxState.UNKNOWN, null, "차량 플랫폼 확인 중")
        if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_AUTOMOTIVE)) {
            onChanged(VehicleUxState.UNKNOWN, null, "일반 Android · 차량 플랫폼 미연결")
            return
        }
        try {
            connection = CarConnection(expected)
        } catch (_: LinkageError) {
            onChanged(VehicleUxState.UNKNOWN, null, "차량 제한 API 미지원")
        } catch (_: Exception) {
            onChanged(VehicleUxState.UNKNOWN, null, "차량 제한 API 사용 불가")
        }
    }

    fun stop() {
        active = false
        session++
        connection?.close()
        connection = null
        onChanged(VehicleUxState.UNKNOWN, null, "차량 서비스 미연결")
    }

    /** Automotive에서만 만든다. 이 클래스 밖에서는 android.car 타입을 쓰지 않는다. */
    private inner class CarConnection(private val expected: Long) {
        private var manager: CarUxRestrictionsManager? = null
        private val car: Car = Car.createCar(context, main, Car.CAR_WAIT_TIMEOUT_DO_NOT_WAIT) { connected, ready ->
            if (!current(expected)) return@createCar
            clearManager()
            if (ready) attach(connected) else onChanged(VehicleUxState.UNKNOWN, null, "차량 서비스 연결 끊김")
        }

        private fun attach(car: Car) {
            if (!current(expected)) return
            try {
                val m = car.getCarManager(Car.CAR_UX_RESTRICTION_SERVICE) as? CarUxRestrictionsManager
                    ?: throw IllegalStateException("missing manager")
                manager = m
                m.registerListener { restrictions -> if (current(expected) && manager === m) apply(restrictions, m) }
                apply(m.currentCarUxRestrictions, m)
            } catch (_: Exception) {
                onChanged(VehicleUxState.UNKNOWN, null, "차량 제한 상태 읽기 실패")
            }
        }

        private fun apply(restrictions: CarUxRestrictions?, expectedManager: CarUxRestrictionsManager) {
            if (!current(expected) || manager !== expectedManager) return
            if (restrictions == null) {
                onChanged(VehicleUxState.UNKNOWN, null, "차량 제한 상태 미확인")
                return
            }
            val flags = restrictions.activeRestrictions
            // 받은 제한 비트가 하나라도 있으면 보수적으로 설정을 잠근다.
            val state = if (restrictions.isRequiresDistractionOptimization || flags != 0) VehicleUxState.RESTRICTED else VehicleUxState.UNRESTRICTED
            main.post { if (current(expected) && manager === expectedManager) onChanged(state, flags, "AAOS 차량 제한 상태") }
        }

        private fun clearManager() {
            val previous = manager
            manager = null
            try { previous?.unregisterListener() } catch (_: Exception) { }
        }

        fun close() {
            clearManager()
            try { car.disconnect() } catch (_: Exception) { }
        }
    }
}
