package kr.signal.drive

import android.app.Activity
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.widget.*
import kr.signal.drive.core.*
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.util.concurrent.Executors
import kotlin.math.ceil

/** Native local MVP. Simulation, traffic trust, and AAOS UX restrictions remain separate. */
class MainActivity : Activity() {
    // 색. 신호 색(green/red/amber)은 확인된 신호를 그릴 때만 쓴다.
    private val bg = Color.rgb(10, 14, 19)
    private val surface = Color.rgb(20, 27, 35)
    private val raised = Color.rgb(29, 38, 49)
    private val line = Color.rgb(44, 56, 70)
    private val ink = Color.rgb(238, 242, 240)
    private val muted = Color.rgb(140, 154, 166)
    private val mint = Color.rgb(61, 220, 151)
    private val signalGreen = Color.rgb(61, 220, 151)
    private val signalRed = Color.rgb(255, 99, 99)
    private val signalAmber = Color.rgb(255, 194, 75)
    private val handler = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()
    private val clockGuard = ClockGuard()
    private var active = false
    private var clockValid = true
    private var generation = 0
    private var inFlight = false
    private var modeDemo = true
    private var scenario = "정상 녹색"
    private var scenarioExpires = 0L
    private var actualUx = VehicleUxState.UNKNOWN
    private var simulatedUx = VehicleUxState.UNRESTRICTED
    private var platformMessage = "차량 플랫폼 미연결"
    private var packet: SignalObservation? = null
    private var liveMessage = "검증된 대상 교차로가 등록되지 않았습니다"
    private var lastPoll = 0L
    private val mappings by lazy { loadMappings() }
    private val engine by lazy { TrustEngine(approvedMappings = mappings) }
    private val demoTarget = SignalTarget("DEMO-001", Approach.NW, Movement.STRAIGHT)
    private val automotive by lazy { packageManager.hasSystemFeature(PackageManager.FEATURE_AUTOMOTIVE) }
    private val liveMapping get() = mappings.firstOrNull { it.verification == MappingVerification.VERIFIED && !it.evidenceReference.isNullOrBlank() }
    private val liveTarget get() = liveMapping?.let { SignalTarget(it.intersectionId, it.approach, it.movement, it.id, it.version) }
    private val restrictions by lazy { CarRestrictionsAdapter(this) { state, flags, message ->
        actualUx = state
        platformMessage = if (flags == null) message else "$message · flags $flags"
        // 실제 차량에서 제한이 걸리면(주행·미확인) 시연 데이터를 끈다.
        // "시연" 배지가 있어도 주행 중 운전자가 가짜 신호를 진짜로 볼 수 있기 때문이다.
        // 정차해도 자동으로 시연으로 돌아가지 않는다(사용자가 다시 고른다).
        if (automotive && state != VehicleUxState.UNRESTRICTED && modeDemo) leaveDemoForDriving()
        if (active) renderState()
    } }

    private fun leaveDemoForDriving() {
        modeDemo = false
        generation++
        packet = null
        lastPoll = 0L
        clockGuard.reset()
        clockValid = true
    }

    private lateinit var sourceLabel: TextView
    private lateinit var titleLabel: TextView
    private lateinit var directionLabel: TextView
    private lateinit var phaseLabel: TextView
    private lateinit var timeLabel: TextView
    private lateinit var reasonLabel: TextView
    private lateinit var timestampLabel: TextView
    private lateinit var uxLabel: TextView
    private lateinit var platformLabel: TextView
    private lateinit var controls: LinearLayout
    private lateinit var modeDemoButton: Button
    private lateinit var modeLiveButton: Button
    private lateinit var footerLabel: TextView
    private lateinit var lamp: SignalLamp
    private lateinit var signalCard: LinearLayout
    private lateinit var uxDot: View
    private lateinit var modesRow: View
    private lateinit var infoCard: View
    private var driving = false
    private var drivingApplied: Boolean? = null
    private var sideColumn: LinearLayout? = null
    private var wideLayout = false
    private lateinit var headRow: LinearLayout
    private lateinit var signalStack: LinearLayout
    private lateinit var drivingStatus: TextView
    private lateinit var setupGuide: View
    private lateinit var versionLabel: TextView
    private var signalShown: Boolean? = null
    private var cardKey = ""
    private var chromeKey = ""
    private val scenarioButtons = mutableListOf<Button>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        modeDemo = !automotive
        buildScreen()
    }

    override fun onStart() {
        super.onStart()
        active = true
        generation++
        packet = null
        clockGuard.reset()
        clockValid = true
        lastPoll = 0L
        scenarioExpires = System.currentTimeMillis() + 24_000L
        restrictions.start()
        tick.run()
    }

    override fun onStop() {
        active = false
        generation++
        packet = null
        handler.removeCallbacks(tick)
        restrictions.stop()
        super.onStop()
    }

    override fun onDestroy() { executor.shutdownNow(); super.onDestroy() }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        buildScreen()
    }

    private val tick = object : Runnable {
        override fun run() {
            if (!active) return
            val now = System.currentTimeMillis()
            if (!clockGuard.checkpoint(now, SystemClock.elapsedRealtime())) {
                if (clockValid) generation++
                clockValid = false
                packet = null
                liveMessage = "시각 변경 감지 · 화면을 다시 열어 데이터를 갱신하세요"
            } else if (modeDemo) {
                packet = demoPacket(now)
            } else if (SystemClock.elapsedRealtime() - lastPoll >= 1_000L) {
                fetchLive()
            }
            renderState()
            handler.postDelayed(this, 200L)
        }
    }

    private fun buildScreen() {
        scenarioButtons.clear()
        cardKey = ""; chromeKey = ""; drivingApplied = null; sideColumn = null
        val cfg = resources.configuration
        val wide = cfg.screenWidthDp >= 600 && cfg.screenWidthDp > cfg.screenHeightDp
        wideLayout = wide
        val scroll = ScrollView(this).apply { setBackgroundColor(bg); isFillViewport = true }
        val root = column().apply { val side = dp(if (wide) 28 else 18); setPadding(side, dp(14), side, dp(24)) }
        scroll.addView(root)
        setContentView(scroll)

        // ── 상단: 이름 · 출처 배지 ──
        val top = row()
        top.addView(text("SIGNAL", 19f, ink, true).apply { letterSpacing = 0.14f })
        top.addView(text(" Drive", 19f, mint, true))
        versionLabel = text("   v${BuildConfig.VERSION_NAME}", 11f, muted)
        top.addView(versionLabel, LinearLayout.LayoutParams(0, -2, 1f))
        sourceLabel = text("", 12f, ink, true).apply { setPadding(dp(12), dp(6), dp(12), dp(6)) }
        top.addView(sourceLabel)
        root.addView(top)

        // ── 화면 전환 (세그먼트) ──
        val modes = row().apply { background = rounded(surface, 14); setPadding(dp(4), dp(4), dp(4), dp(4)) }
        modesRow = modes
        modeDemoButton = segment("시연 화면") { changeMode(true) }
        modeLiveButton = segment("실시간 연결 상태") { changeMode(false) }
        modes.addView(modeDemoButton, LinearLayout.LayoutParams(0, dp(42), 1f))
        modes.addView(modeLiveButton, LinearLayout.LayoutParams(0, dp(42), 1f).apply { leftMargin = dp(4) })
        root.addView(modes, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(14) })

        // ── 신호 카드: 신호 원 + 상태 + 남은 시간 + 이유 ──
        lamp = SignalLamp(this)
        phaseLabel = text("", if (wide) 30f else 26f, ink).apply { typeface = weight(600) }
        timeLabel = text("", if (wide) 88f else 72f, ink).apply {
            typeface = weight(700); fontFeatureSettings = "tnum"; includeFontPadding = false; letterSpacing = -0.03f; maxLines = 1
        }
        reasonLabel = text("", 15f, Color.rgb(200, 210, 214))
        signalCard = column().apply { setPadding(dp(22), dp(22), dp(22), dp(20)) }
        // 신호 원과 상태·남은 시간을 나란히. 가로 화면은 높이가 낮으므로 세로로 쌓지 않는다.
        val head = row()
        headRow = head
        val lampSize = dp(if (wide) 132 else 104)
        head.addView(lamp, LinearLayout.LayoutParams(lampSize, lampSize).apply { rightMargin = dp(if (wide) 24 else 18) })
        val stack = column()
        signalStack = stack
        stack.addView(phaseLabel)
        stack.addView(timeLabel)
        head.addView(stack, LinearLayout.LayoutParams(0, -2, 1f))
        signalCard.addView(head)
        signalCard.addView(reasonLabel, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) })
        // 주행 화면에서만 카드 안에 보이는 차량 상태 한 줄(가로 화면은 오른쪽 열을 숨기므로)
        drivingStatus = text("", 15f, signalAmber).apply { typeface = weight(600); visibility = View.GONE }
        signalCard.addView(drivingStatus, LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(10) })

        // ── 교차로 정보 ──
        titleLabel = text("", 18f, ink, true)
        directionLabel = text("", 13f, ink).apply { background = rounded(raised, 10); setPadding(dp(10), dp(4), dp(10), dp(4)) }
        timestampLabel = text("", 12f, muted).apply { fontFeatureSettings = "tnum"; setPadding(0, dp(10), 0, 0) }
        val info = column().apply { background = rounded(surface, 18); setPadding(dp(18), dp(16), dp(18), dp(16)) }
        info.addView(caption("교차로"))
        info.addView(titleLabel)
        info.addView(directionLabel, LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(8) })
        info.addView(timestampLabel)
        // 실시간 모드에 검증된 교차로가 없을 때: 무엇을 해야 신호가 켜지는지 보여준다.
        val guide = column().apply { setPadding(0, dp(14), 0, 0) }
        guide.addView(caption("실시간 표시가 켜지는 조건"))
        listOf("현장에서 교차로·진입 방향·이동 종류 확인", "매핑과 근거를 운영자가 등록", "소유 서버에서 원천 시각·만료 검증").forEachIndexed { i, step ->
            val r = row().apply { setPadding(0, dp(5), 0, dp(5)) }
            r.addView(text("${i + 1}", 12f, muted).apply { typeface = weight(600); gravity = Gravity.CENTER; background = rounded(raised, 10) }, LinearLayout.LayoutParams(dp(22), dp(22)).apply { rightMargin = dp(10) })
            r.addView(text(step, 13f, ink), LinearLayout.LayoutParams(0, -2, 1f))
            guide.addView(r)
        }
        guide.addView(text("현재 등록된 교차로 ${mappings.size}곳 · 그 전까지 신호를 표시하지 않습니다", 12f, muted).apply { setPadding(0, dp(6), 0, 0) })
        info.addView(guide)
        setupGuide = guide
        infoCard = info

        // ── 차량 상태 ──
        uxDot = View(this)
        uxLabel = text("", 14f, ink, true)
        platformLabel = text("", 12f, muted).apply { setPadding(0, dp(2), 0, 0) }
        val status = row().apply { background = rounded(surface, 18); setPadding(dp(18), dp(14), dp(18), dp(14)) }
        status.addView(uxDot, LinearLayout.LayoutParams(dp(10), dp(10)).apply { rightMargin = dp(12) })
        status.addView(column().apply { addView(uxLabel); addView(platformLabel) }, LinearLayout.LayoutParams(0, -2, 1f))

        // ── 시연 콘솔 (가상 입력) ──
        controls = column().apply { background = dashed(); setPadding(dp(14), dp(12), dp(14), dp(10)) }
        val consoleHead = row()
        consoleHead.addView(text("시연 콘솔", 13f, ink, true))
        consoleHead.addView(text("  가상 입력 · 실제 차량·신호에 영향 없음", 11f, muted), LinearLayout.LayoutParams(0, -2, 1f))
        controls.addView(consoleHead, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(6) })
        val scenarios = listOf("정상 녹색", "정상 적색", "데이터 지연", "연결 단절", "교차로 불일치", "방향 미확정", "미래 시각", "잔여시간 만료", "복구")
        scenarios.chunked(3).forEach { group ->
            val r = row()
            group.forEachIndexed { i, name ->
                val b = chip(name) { if (canControl()) selectScenario(name) }
                scenarioButtons.add(b)
                r.addView(b, LinearLayout.LayoutParams(0, dp(44), 1f).apply { setMargins(if (i == 0) 0 else dp(6), dp(3), 0, dp(3)) })
            }
            controls.addView(r)
        }
        var vehicle: LinearLayout? = null
        if (!automotive) {
            vehicle = column().apply { background = dashed(); setPadding(dp(14), dp(10), dp(14), dp(12)) }
            vehicle.addView(text("모의 차량 상태 · 시험 운영자용", 11f, muted).apply { setPadding(0, 0, 0, dp(6)) })
            val r = row()
            listOf("정차" to VehicleUxState.UNRESTRICTED, "주행" to VehicleUxState.RESTRICTED, "미확인" to VehicleUxState.UNKNOWN).forEachIndexed { i, (label, state) ->
                r.addView(chip(label) { simulatedUx = state; renderState() }, LinearLayout.LayoutParams(0, dp(42), 1f).apply { if (i > 0) leftMargin = dp(6) })
            }
            vehicle.addView(r)
        }
        footerLabel = text("실제 신호등과 도로 상황을 우선 확인하세요.\n실시간 표시·Pleos 실행·주행 허용은 별도 검증이 필요합니다.", 11f, muted).apply { setPadding(dp(2), dp(16), 0, 0) }

        val gap = dp(12)
        if (wide) {
            val body = row().apply { gravity = Gravity.TOP }
            body.addView(signalCard, LinearLayout.LayoutParams(0, -2, 1f))
            val side = column()
            side.addView(info)
            side.addView(status, LinearLayout.LayoutParams(-1, -2).apply { topMargin = gap })
            side.addView(controls, LinearLayout.LayoutParams(-1, -2).apply { topMargin = gap })
            vehicle?.let { side.addView(it, LinearLayout.LayoutParams(-1, -2).apply { topMargin = gap }) }
            body.addView(side, LinearLayout.LayoutParams(0, -2, 1.15f).apply { leftMargin = dp(16) })
            sideColumn = side
            root.addView(body, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(16) })
        } else {
            root.addView(signalCard, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(14) })
            root.addView(info, LinearLayout.LayoutParams(-1, -2).apply { topMargin = gap })
            root.addView(status, LinearLayout.LayoutParams(-1, -2).apply { topMargin = gap })
            root.addView(controls, LinearLayout.LayoutParams(-1, -2).apply { topMargin = gap })
            vehicle?.let { root.addView(it, LinearLayout.LayoutParams(-1, -2).apply { topMargin = gap }) }
        }
        root.addView(footerLabel)
        renderState()
    }

    private fun canControl() = VehicleUxPolicy.evaluate(if (automotive || !modeDemo) actualUx else simulatedUx).canOpenSettings

    private fun changeMode(demo: Boolean) {
        if (automotive && actualUx != VehicleUxState.UNRESTRICTED) return
        if (!automotive && modeDemo && simulatedUx != VehicleUxState.UNRESTRICTED) return
        modeDemo = demo
        generation++
        packet = null
        lastPoll = 0L
        clockGuard.reset()
        clockValid = true
        scenarioExpires = System.currentTimeMillis() + 24_000L
        renderState()
    }

    private fun selectScenario(name: String) {
        scenario = name
        scenarioExpires = System.currentTimeMillis() + 24_000L
        packet = null
        clockGuard.reset()
        clockValid = true
        renderState()
    }

    private fun demoPacket(now: Long): SignalObservation? {
        if (scenario == "연결 단절") return null
        val source = when (scenario) { "데이터 지연" -> now - 5_000L; "미래 시각" -> now + 5_000L; "잔여시간 만료" -> now - 1_000L; else -> now }
        val remaining = if (scenario == "잔여시간 만료") 5L else ceil((scenarioExpires - source) / 100.0).toLong()
        return SignalObservation(
            intersectionId = if (scenario == "교차로 불일치") "DEMO-999" else "DEMO-001",
            approach = if (scenario == "방향 미확정") null else Approach.NW,
            movement = Movement.STRAIGHT,
            phase = if (scenario == "정상 적색") SignalPhase.RED else SignalPhase.GREEN,
            provenance = Provenance.SIMULATION,
            sourceTimestampEpochMs = source,
            remainingDeciseconds = remaining,
        )
    }

    private fun renderState() {
        if (!::sourceLabel.isInitialized) return
        val target = if (modeDemo) demoTarget else liveTarget
        val d = engine.evaluate(target, if (clockValid) packet else null, System.currentTimeMillis(), if (modeDemo) DisplayMode.DEMONSTRATION else DisplayMode.LIVE_ONLY)
        sourceLabel.put(if (modeDemo) "시연 데이터 · 실제 신호 아님" else "실시간 연결 · 검증된 데이터만 표시")
        titleLabel.put(if (modeDemo) "가상 교차로 01" else liveMapping?.intersectionId?.let { "교차로 $it" } ?: "검증된 교차로 미등록")
        directionLabel.put(if (modeDemo) "북서 접근  /  직진" else target?.let { "${it.approach?.name} 접근  /  ${it.movement?.name}" } ?: "대상 교차로와 진행 방향 확인 필요")
        if (d.canShowSignal) {
            val name = when (d.phase) { SignalPhase.GREEN -> "녹색"; SignalPhase.RED -> "적색"; SignalPhase.YELLOW -> "황색"; else -> "" }
            val c = when (d.phase) { SignalPhase.GREEN -> signalGreen; SignalPhase.RED -> signalRed; else -> signalAmber }
            if (signalShown == false) { signalStack.alpha = 0f; signalStack.animate().alpha(1f).setDuration(200).start() }
            signalShown = true
            phaseLabel.put("$name 신호")
            phaseLabel.putColor(c)
            lamp.color = c
            paintCard(c)
            timeLabel.visibility = View.VISIBLE
            timeLabel.put(seconds(d.remainingSeconds))
            timeLabel.putDescription("${if(modeDemo) "시연 " else ""}잔여시간 ${d.remainingSeconds}초")
        } else {
            // 확인 불가는 애니메이션 없이 즉시 (지난 숫자가 서서히 사라지는 일이 없게)
            signalStack.animate().cancel(); signalStack.alpha = 1f
            signalShown = false
            phaseLabel.put("현재 신호\n확인 불가")
            phaseLabel.putColor(ink)
            lamp.color = null
            paintCard(null)
            timeLabel.put("")
            timeLabel.putDescription("")
            timeLabel.visibility = View.GONE
        }
        reasonLabel.put(if (!clockValid) "시각 변경 감지 · 재수신 전까지 표시를 중단합니다" else if (!modeDemo && packet == null) liveMessage else d.reason.messageKo)
        timestampLabel.put(d.sourceTimestampEpochMs?.let { "원천 시각 ${java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.KOREA).format(java.util.Date(it))}  ·  원천 시각 기준 만료" } ?: "원천 시각 없음")
        val state = if (automotive || !modeDemo) actualUx else simulatedUx
        val ux = VehicleUxPolicy.evaluate(state)
        // 실제 차량은 정차가 확인되지 않으면(주행·미확인) 주행 화면, 일반 Android는 모의 '주행'일 때만.
        driving = state == VehicleUxState.RESTRICTED || (automotive && state != VehicleUxState.UNRESTRICTED)
        uxLabel.put(when {
            modeDemo && !automotive -> "모의 차량 ${when(state) { VehicleUxState.UNRESTRICTED -> "정차"; VehicleUxState.RESTRICTED -> "주행 · 설정 잠금"; else -> "미확인 · 설정 잠금" }}"
            driving -> if (state == VehicleUxState.RESTRICTED) "주행 중 · 설정 잠금" else "차량 상태 미확인 · 설정 잠금"
            else -> ux.messageKo
        })
        platformLabel.put(platformMessage)
        // 주행 화면: 신호 원·남은 시간·이유 한 줄·차량 상태만 남긴다.
        val full = if (driving) View.GONE else View.VISIBLE
        modesRow.visibility = full
        infoCard.visibility = full
        footerLabel.visibility = full
        platformLabel.visibility = full
        versionLabel.visibility = if (driving) View.INVISIBLE else View.VISIBLE  // 자리는 남겨 배지와 붙지 않게
        setupGuide.visibility = if (!modeDemo && liveMapping == null) View.VISIBLE else View.GONE
        drivingStatus.visibility = if (driving && wideLayout) View.VISIBLE else View.GONE
        if (driving && wideLayout) drivingStatus.put("●  ${uxLabel.text}")
        reasonLabel.maxLines = if (driving) 1 else Int.MAX_VALUE
        reasonLabel.ellipsize = if (driving) android.text.TextUtils.TruncateAt.END else null
        controls.visibility = if (modeDemo && !driving) View.VISIBLE else View.GONE
        if (drivingApplied != driving) applyDrivingScale(driving)
        scenarioButtons.forEach { it.isEnabled = ux.canRunDemonstration; it.alpha = if(it.isEnabled) 1f else 0.35f }
        modeDemoButton.isEnabled = if (automotive) actualUx == VehicleUxState.UNRESTRICTED else !modeDemo || simulatedUx == VehicleUxState.UNRESTRICTED
        modeLiveButton.isEnabled = if (automotive) actualUx == VehicleUxState.UNRESTRICTED else !modeDemo || simulatedUx == VehicleUxState.UNRESTRICTED
        paintChrome(ux.canRunDemonstration, state)
        if (uiTrace) traceUi()
    }

    // 값이 실제로 바뀔 때만 쓴다. 같은 값을 0.2초마다 다시 쓰면 접근성 서비스에 변경 알림이 쏟아지고
    // 화면이 한 번도 '잠잠한' 상태가 되지 않는다(UI Automator가 화면을 읽지 못한 원인).
    private fun TextView.put(value: CharSequence) { if (text.toString() != value.toString()) text = value }
    private fun TextView.putDescription(value: String) { if ((contentDescription?.toString() ?: "") != value) contentDescription = value }
    private fun TextView.putColor(color: Int) { if (currentTextColor != color) setTextColor(color) }

    // ── 검증용 화면 기록 ──
    // 남은 초가 1초마다 바뀌는 동안에는 UI Automator가 화면을 읽지 못한다(1초 무변화를 기다림).
    // 그래서 기기 검증 스크립트는 이 기록으로 "지금 화면에 실제로 보이는 것"을 확인한다.
    // `adb shell setprop log.tag.SignalDriveUi DEBUG`로 켤 때만 남고 기본은 꺼져 있다.
    // 화면에 보이는 문구와 버튼 위치만 담는다. 키·주소·패킷 원문은 넣지 않는다.
    private val uiTrace by lazy { android.util.Log.isLoggable(TRACE_TAG, android.util.Log.DEBUG) }
    private var lastTrace = ""

    private fun traceUi() {
        if (!window.decorView.isAttachedToWindow) return  // 붙기 전에는 보이는 상태가 아니다
        val frame = android.graphics.Rect().also { window.decorView.getWindowVisibleDisplayFrame(it) }
        fun onScreen(v: View): Boolean {
            if (!v.isShown) return false
            val at = IntArray(2); v.getLocationOnScreen(at)
            return at[1] >= frame.top && at[1] + v.height <= frame.bottom
        }
        val buttons = JSONArray()
        fun walk(v: View) {
            if (v is Button && v.isShown) {
                val at = IntArray(2); v.getLocationOnScreen(at)
                buttons.put(JSONObject().put("text", v.text.toString()).put("enabled", v.isEnabled).put("onScreen", onScreen(v))
                    .put("x", at[0] + v.width / 2).put("y", at[1] + v.height / 2))
            }
            if (v is android.view.ViewGroup) for (i in 0 until v.childCount) walk(v.getChildAt(i))
        }
        walk(window.decorView)
        val o = JSONObject()
            .put("source", sourceLabel.text.toString())
            .put("phase", phaseLabel.text.toString())
            .put("seconds", if (timeLabel.isShown) timeLabel.text.toString() else "")
            .put("secondsDesc", if (timeLabel.isShown) (timeLabel.contentDescription?.toString() ?: "") else "")
            .put("reason", reasonLabel.text.toString())
            .put("ux", uxLabel.text.toString())
            .put("footerOnScreen", onScreen(footerLabel))
            .put("driving", driving)
            .put("footerBox", IntArray(2).also { footerLabel.getLocationOnScreen(it) }.let { "${it[1]}..${it[1] + footerLabel.height} in ${frame.top}..${frame.bottom}" })
            .put("buttons", buttons)
            .toString()
        if (o != lastTrace) { lastTrace = o; android.util.Log.i(TRACE_TAG, o) }
    }

    private fun fetchLive() {
        lastPoll = SystemClock.elapsedRealtime()
        val mapping = liveMapping
        if (mapping == null || BuildConfig.BACKEND_URL.isBlank()) {
            packet = null
            liveMessage = if (mapping == null) "검증된 교차로·진행 방향 등록이 필요합니다" else "소유 서버의 HTTPS 주소 설정이 필요합니다"
            return
        }
        if (inFlight) return
        inFlight = true
        val requestGeneration = generation
        executor.execute {
            val deadline = SystemClock.elapsedRealtime() + 4_000L
            var next: SignalObservation? = null
            var error = "현재 신호 데이터를 확인할 수 없습니다"
            var connection: HttpURLConnection? = null
            try {
                val base = URI(BuildConfig.BACKEND_URL)
                require(base.scheme == "https" && !base.host.isNullOrBlank() && base.userInfo == null && base.fragment == null && base.rawQuery == null)
                val url = URI(base.toString().trimEnd('/') + "/api/signal?target=" + java.net.URLEncoder.encode(mapping.id, "UTF-8")).toURL()
                connection = (url.openConnection() as HttpURLConnection).apply { connectTimeout = 1_500; readTimeout = 1_500; instanceFollowRedirects = false; setRequestProperty("Accept", "application/json") }
                require(connection.responseCode == 200)
                val bytes = connection.inputStream.use { input ->
                    val out = java.io.ByteArrayOutputStream(); val buffer = ByteArray(4_096)
                    while(true) { require(SystemClock.elapsedRealtime() < deadline); val n = input.read(buffer); if(n<0) break; require(out.size()+n<=65_536); out.write(buffer,0,n) }
                    out.toByteArray()
                }
                val json = JSONObject(String(bytes, Charsets.UTF_8))
                require(json.getInt("schemaVersion") == 1 && json.getString("source") == "live")
                error = "실시간 데이터가 유효하지 않습니다 · ${json.optString("reason", "unknown") }"
                if (json.getString("status") == "verified") {
                    val t = json.getJSONObject("target")
                    require(json.getString("phase") in setOf("RED", "GREEN"))
                    val sourceTime = requireNotNull(exactLong(json,"sourceTimestampMs"))
                    val remainingTime = requireNotNull(exactLong(json,"remainingDeciseconds"))
                    require(sourceTime > 0L && remainingTime in 1L..36_000L && sourceTime <= Long.MAX_VALUE - remainingTime * 100L)
                    require(exactLong(json,"expiresAtMs") == sourceTime + remainingTime * 100L)
                    next = SignalObservation(t.getString("intersectionId"), Approach.fromWire(t.getString("approach")),
                        Movement.fromWire(t.getString("movement")), SignalPhase.fromWire(json.getString("phase")), Provenance.LIVE,
                        sourceTime, remainingTime, t.getString("id"), t.getString("mappingVersion"))
                }
            } catch (_: Exception) { error = "연결을 확인할 수 없습니다 · 신호 표시를 중단합니다" }
            finally { connection?.disconnect() }
            handler.post {
                inFlight = false
                if (active && !modeDemo && clockValid && generation == requestGeneration) { packet = next; liveMessage = error; renderState() }
            }
        }
    }

    private fun exactLong(o: JSONObject, key: String): Long? = when(val value = o.opt(key)) { is Long -> value; is Int -> value.toLong(); else -> null }

    private fun loadMappings(): List<MovementMapping> = try {
        val data = JSONArray(assets.open("approved-mappings.json").bufferedReader().use { it.readText() })
        (0 until data.length()).mapNotNull { index ->
            val o = data.getJSONObject(index)
            val approach = Approach.fromWire(o.optString("approach"))
            val movement = Movement.fromWire(o.optString("movement"))
            if (approach == null || movement == null) null else MovementMapping(o.getString("id"),o.getString("version"),o.getString("intersectionId"),approach,movement,
                if(o.optString("verification")=="VERIFIED") MappingVerification.VERIFIED else MappingVerification.UNVERIFIED,o.optString("evidenceReference").takeIf(String::isNotBlank))
        }
    } catch (_: Exception) { emptyList() }

    private fun dp(n: Int) = (n * resources.displayMetrics.density).toInt()
    private fun column() = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    private fun row() = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    private fun rounded(color: Int, radius: Int = 14, stroke: Int? = null, dash: Boolean = false) = GradientDrawable().apply {
        setColor(color); cornerRadius = dp(radius).toFloat()
        if (stroke != null) { if (dash) setStroke(dp(1), stroke, dp(6).toFloat(), dp(5).toFloat()) else setStroke(dp(2), stroke) }
    }
    private fun weight(w: Int): Typeface = Typeface.create(Typeface.DEFAULT, w, false)
    private fun dashed() = rounded(bg, 18, line, dash = true)
    private fun caption(value: String) = text(value, 11f, muted, true).apply { letterSpacing = 0.08f; setPadding(0, 0, 0, dp(6)) }
    private fun blend(a: Int, b: Int, t: Float) = Color.rgb(
        (Color.red(a) * (1 - t) + Color.red(b) * t).toInt(), (Color.green(a) * (1 - t) + Color.green(b) * t).toInt(), (Color.blue(a) * (1 - t) + Color.blue(b) * t).toInt())
    private fun seconds(n: Long?) = android.text.SpannableString("${n}초").apply {
        setSpan(android.text.style.RelativeSizeSpan(0.42f), length - 1, length, 0)
    }

    /** 주행 화면에서는 신호를 키우고, 가로 화면이면 오른쪽 열을 좁힌다. 상태가 바뀔 때만 실행. */
    private fun applyDrivingScale(on: Boolean) {
        drivingApplied = on
        val lampSize = dp(when { on && wideLayout -> 240; on -> 124; wideLayout -> 132; else -> 104 })
        lamp.layoutParams = (lamp.layoutParams as LinearLayout.LayoutParams).apply { width = lampSize; height = lampSize; rightMargin = dp(when { on && wideLayout -> 36; on -> 22; wideLayout -> 24; else -> 18 }) }
        timeLabel.textSize = when { on && wideLayout -> 150f; on -> 90f; wideLayout -> 88f; else -> 72f }
        phaseLabel.textSize = when { on && wideLayout -> 40f; on -> 30f; wideLayout -> 30f; else -> 26f }
        reasonLabel.textSize = if (on) 19f else 15f
        // 가로 주행 화면: 오른쪽 열을 숨기고 신호 카드가 화면을 채운다. 내용은 가운데.
        val fill = on && wideLayout
        sideColumn?.visibility = if (fill) View.GONE else View.VISIBLE
        signalStack.layoutParams = (signalStack.layoutParams as LinearLayout.LayoutParams).apply { width = if (fill) -2 else 0; weight = if (fill) 0f else 1f }
        headRow.gravity = if (fill) Gravity.CENTER else Gravity.CENTER_VERTICAL
        reasonLabel.gravity = if (fill) Gravity.CENTER else Gravity.START
        signalCard.gravity = if (fill) Gravity.CENTER else Gravity.START
        signalCard.minimumHeight = if (fill) resources.displayMetrics.heightPixels - dp(150) else 0
        signalCard.setPadding(dp(22), dp(if (fill) 28 else 22), dp(22), dp(if (fill) 28 else 20))
    }

    /** 신호 카드 바탕. 확인된 신호면 그 색을 아주 옅게 깔고, 확인 불가면 점선 테두리의 빈 카드. */
    private fun paintCard(c: Int?) {
        val key = c?.toString() ?: "none"
        if (key == cardKey) return
        cardKey = key
        signalCard.background = if (c == null) rounded(surface, 24, line, dash = true)
            else rounded(blend(surface, c, 0.10f), 24, Color.argb(130, Color.red(c), Color.green(c), Color.blue(c)))
    }

    /** 출처 배지·화면 전환·차량 상태 점. 바뀔 때만 다시 칠한다. */
    private fun paintChrome(canDemo: Boolean, state: VehicleUxState) {
        val key = "$modeDemo/$canDemo/$state/${modeDemoButton.isEnabled}"
        if (key == chromeKey) return
        chromeKey = key
        val badge = if (modeDemo) signalAmber else mint
        sourceLabel.background = rounded(blend(bg, badge, 0.16f), 20)
        sourceLabel.setTextColor(badge)
        listOf(modeDemoButton to modeDemo, modeLiveButton to !modeDemo).forEach { (b, on) ->
            b.background = rounded(if (on) raised else Color.TRANSPARENT, 11)
            b.setTextColor(if (on) ink else muted)
            b.alpha = if (b.isEnabled) 1f else 0.4f
        }
        uxDot.background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(if (state == VehicleUxState.UNRESTRICTED) mint else signalAmber) }
    }
    private fun text(value: String, size: Float, color: Int, bold: Boolean = false) = TextView(this).apply { text=value; textSize=size; setTextColor(color); if(bold) setTypeface(typeface,Typeface.BOLD); setLineSpacing(dp(3).toFloat(),1f) }
    private fun segment(label: String, click: () -> Unit) = Button(this).apply {
        text = label; textSize = 13f; isAllCaps = false; stateListAnimator = null; minHeight = 0; minimumHeight = 0
        setPadding(0, 0, 0, 0); setOnClickListener { click() }
    }
    private fun chip(label: String, click: () -> Unit) = Button(this).apply {
        text = label; textSize = 13f; isAllCaps = false; setTextColor(ink); stateListAnimator = null
        background = rounded(raised, 12); minHeight = 0; minimumHeight = 0; setPadding(dp(4), 0, dp(4), 0)
        setOnClickListener { click() }
    }

    private companion object { const val TRACE_TAG = "SignalDriveUi" }
}
