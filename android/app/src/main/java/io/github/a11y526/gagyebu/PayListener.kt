package io.github.a11y526.gagyebu

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.util.Locale

// 카드·은행 앱 알림을 읽어 가계부에 바로 기록한다
class PayListener : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val pkg = sbn.packageName ?: return
        if (pkg == packageName || !PayParser.accepts(pkg)) return
        val ex = sbn.notification.extras
        val raw = listOf(Notification.EXTRA_TITLE, Notification.EXTRA_TEXT, Notification.EXTRA_BIG_TEXT)
            .mapNotNull { ex.getCharSequence(it)?.toString() }.distinct().joinToString(" ")
        if (raw.isBlank()) return
        val pay = PayParser.parse(pkg, raw, ex.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: "") ?: return
        // 같은 알림이 다시 올라오면 한 번만 (10분)
        val sig = "$pkg|${pay.amt}|${pay.cancel}|${pay.place}"
        val prefs = getSharedPreferences("gb", MODE_PRIVATE)
        val now = System.currentTimeMillis()
        if (prefs.getString("last_sig", "") == sig && now - prefs.getLong("last_at", 0) < 600_000) return
        prefs.edit().putString("last_sig", sig).putLong("last_at", now).apply()

        val key = Api.key(this)
        Thread {
            var result = "열쇠 없음"
            try {
                if (key != null) {
                    val body = JSONObject().put("p_key", key).put("p_amt", pay.amt).put("p_place", pay.place).put("p_source", "android")
                    val r = Api.rpc(if (pay.cancel) "gb_phone_cancel" else "gb_phone_add", body)
                    val won = NumberFormat.getInstance(Locale.KOREA).format(pay.amt) + "원"
                    result = when {
                        r.optBoolean("ok") && pay.cancel -> { Notify.recorded(this, null, "결제 취소 · $won", pay.place.ifEmpty { "가계부에서 취소로 바꿨어요" }, false); "취소" }
                        r.optBoolean("ok") && r.has("fixed") -> { Notify.recorded(this, null, "${r.optString("fixed")} · $won", "고정비로 기록했어요", false); "고정비" }
                        r.optBoolean("ok") && r.optBoolean("dup") -> "중복이라 건너뜀"
                        r.optBoolean("ok") -> { Notify.recorded(this, r.optString("id"), "${pay.place.ifEmpty { "결제" }} · $won 기록됨", "같이 먹었으면 아래 버튼을 눌러요", true); "기록" }
                        else -> "실패 ${r.optString("error")}"
                    }
                }
            } catch (e: Exception) { result = "실패 ${e.javaClass.simpleName}" }
            log(pkg, raw, pay, result)
        }.start()
    }

    // 최근 알림 30건 (앱 설정 화면에서 확인용, 이 휴대폰에만 저장)
    private fun log(pkg: String, raw: String, p: Pay, result: String) {
        val prefs = getSharedPreferences("gb", MODE_PRIVATE)
        val arr = try { JSONArray(prefs.getString("log", "[]")) } catch (e: Exception) { JSONArray() }
        val item = JSONObject().put("at", System.currentTimeMillis()).put("app", pkg).put("text", raw.take(200))
            .put("amt", p.amt).put("place", p.place).put("cancel", p.cancel).put("result", result)
        val out = JSONArray().put(item)
        for (i in 0 until minOf(arr.length(), 29)) out.put(arr.get(i))
        prefs.edit().putString("log", out.toString()).apply()
    }
}
