package kr.signal.drive

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.view.View
import android.view.animation.DecelerateInterpolator
import kotlin.math.min

/**
 * 신호 원. 색은 확인된 신호일 때만 칠한다.
 * [color]가 null이면 색 없이 점선 테두리만 그린다 — "확인 불가"는 빈 원으로 보인다.
 *
 * 전환 규칙: 신호가 **나타날 때만** 짧게(220ms) 커지며 켜진다.
 * 확인 불가로 바뀔 때는 애니메이션 없이 즉시 색을 지운다(틀릴 수 있는 색을 한 프레임도 끌지 않는다).
 * 화면 읽기 정보는 옆의 문구가 담당하므로 이 그림은 접근성 트리에서 뺀다.
 */
class SignalLamp(context: Context) : View(context) {
    var color: Int? = null
        set(value) {
            if (field == value) return
            val appearing = field == null && value != null
            field = value
            appear.cancel()
            progress = if (appearing) 0f else 1f
            if (appearing) appear.start()
            invalidate()
        }

    private var progress = 1f
    private val appear = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 220
        interpolator = DecelerateInterpolator()
        addUpdateListener { progress = it.animatedValue as Float; invalidate() }
    }
    private val density = resources.displayMetrics.density
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val halo = Paint(Paint.ANTI_ALIAS_FLAG)
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 3f * density
        color = Color.rgb(84, 98, 112)
        pathEffect = DashPathEffect(floatArrayOf(10f * density, 8f * density), 0f)
    }

    init { importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO }

    override fun onDetachedFromWindow() { appear.cancel(); super.onDetachedFromWindow() }

    override fun onDraw(canvas: Canvas) {
        val cx = width / 2f
        val cy = height / 2f
        val r = min(width, height) / 2f
        val c = color
        if (c == null) {
            canvas.drawCircle(cx, cy, r * 0.78f, ring)
            return
        }
        val p = progress
        val s = 0.82f + 0.18f * p
        val a = (255 * p).toInt()
        halo.color = Color.argb((46 * p).toInt(), Color.red(c), Color.green(c), Color.blue(c))
        canvas.drawCircle(cx, cy, r * s, halo)
        halo.color = Color.argb((70 * p).toInt(), Color.red(c), Color.green(c), Color.blue(c))
        canvas.drawCircle(cx, cy, r * 0.9f * s, halo)
        fill.color = Color.argb(a, Color.red(c), Color.green(c), Color.blue(c))
        canvas.drawCircle(cx, cy, r * 0.78f * s, fill)
    }
}
