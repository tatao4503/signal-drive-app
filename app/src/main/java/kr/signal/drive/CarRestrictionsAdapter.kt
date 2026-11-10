package kr.signal.drive

import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import kr.signal.drive.core.VehicleUxState
import java.lang.reflect.Proxy

/** Optional public AAOS API, loaded only on Automotive devices. Unknown is fail-closed. */
class CarRestrictionsAdapter(
    private val context: Context,
    private val onChanged: (VehicleUxState, Int?, String) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private var car: Any? = null
    private var manager: Any? = null
    private var listener: Any? = null
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
            val carClass = Class.forName("android.car.Car")
            val lifecycle = Class.forName("android.car.Car\$CarServiceLifecycleListener")
            val callback = proxy(lifecycle) { name, args ->
                if (name == "onLifecycleChanged" && current(expected)) {
                    clearManager()
                    car = args?.get(0)
                    if (args?.get(1) == true) attachRestrictions(carClass, expected) else {
                        onChanged(VehicleUxState.UNKNOWN, null, "차량 서비스 연결 끊김")
                    }
                }
            }
            car = carClass.getMethod("createCar", Context::class.java, Handler::class.java,
                java.lang.Long.TYPE, lifecycle).invoke(null, context, main, 0L, callback)
        } catch (_: Exception) {
            onChanged(VehicleUxState.UNKNOWN, null, "차량 제한 API 사용 불가")
        } catch (_: LinkageError) {
            onChanged(VehicleUxState.UNKNOWN, null, "차량 제한 API 미지원")
        }
    }

    private fun attachRestrictions(carClass: Class<*>, expected: Long) {
        if (!current(expected)) return
        try {
            val service = carClass.getField("CAR_UX_RESTRICTION_SERVICE").get(null) as String
            val currentManager = carClass.getMethod("getCarManager", String::class.java).invoke(car, service)
                ?: throw IllegalStateException("missing manager")
            manager = currentManager
            val type = Class.forName("android.car.drivingstate.CarUxRestrictionsManager\$OnUxRestrictionsChangedListener")
            listener = proxy(type) { name, args ->
                if (name == "onUxRestrictionsChanged" && current(expected) && manager === currentManager) {
                    applyRestriction(args?.firstOrNull(), expected, currentManager)
                }
            }
            currentManager.javaClass.getMethod("registerListener", type).invoke(currentManager, listener)
            applyRestriction(currentManager.javaClass.getMethod("getCurrentCarUxRestrictions").invoke(currentManager), expected, currentManager)
        } catch (_: Exception) {
            onChanged(VehicleUxState.UNKNOWN, null, "차량 제한 상태 읽기 실패")
        }
    }

    private fun applyRestriction(value: Any?, expected: Long, expectedManager: Any) {
        if (!current(expected) || manager !== expectedManager) return
        try {
            requireNotNull(value)
            val required = value.javaClass.getMethod("isRequiresDistractionOptimization").invoke(value) as Boolean
            val flags = value.javaClass.getMethod("getActiveRestrictions").invoke(value) as Int
            // v0.1 intentionally applies all received flags as a conservative settings lock.
            val state = if (required || flags != 0) VehicleUxState.RESTRICTED else VehicleUxState.UNRESTRICTED
            main.post { if (current(expected) && manager === expectedManager) onChanged(state, flags, "AAOS 차량 제한 상태") }
        } catch (_: Exception) {
            onChanged(VehicleUxState.UNKNOWN, null, "차량 제한 상태 미확인")
        }
    }

    private fun proxy(type: Class<*>, call: (String, Array<out Any?>?) -> Unit): Any =
        Proxy.newProxyInstance(type.classLoader, arrayOf(type)) { instance, method, args ->
            when (method.name) {
                "toString" -> "SignalDriveCarCallback"
                "hashCode" -> System.identityHashCode(instance)
                "equals" -> instance === args?.firstOrNull()
                else -> { call(method.name, args); null }
            }
        }

    fun stop() {
        active = false
        session++
        clearManager()
        try { car?.javaClass?.getMethod("disconnect")?.invoke(car) } catch (_: Exception) { }
        car = null
        onChanged(VehicleUxState.UNKNOWN, null, "차량 서비스 미연결")
    }

    private fun clearManager() {
        val previous = manager
        manager = null
        try { previous?.javaClass?.getMethod("unregisterListener")?.invoke(previous) } catch (_: Exception) { }
        listener = null
    }
}
