package io.github.a11y526.gagyebu

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

// 공개해도 되는 값만 (Supabase 주소와 공개 키). 결제 기록은 '휴대폰 열쇠'로만 넣는다.
object Api {
    const val SITE = "https://a11y526.github.io/gagyebu/"
    private const val URL_BASE = "https://sxejmhkevefwnpwldczt.supabase.co/rest/v1/rpc/"
    private const val KEY = "sb_publishable_gdlN0VcGUXOPkXLSqfJn0Q_VYES-EwK"

    fun key(ctx: Context): String? = ctx.getSharedPreferences("gb", Context.MODE_PRIVATE).getString("phone_key", null)
    fun setKey(ctx: Context, k: String?) { ctx.getSharedPreferences("gb", Context.MODE_PRIVATE).edit().putString("phone_key", k).apply() }

    /** RPC 호출 (백그라운드 스레드에서 부를 것) */
    fun rpc(fn: String, body: JSONObject): JSONObject {
        val c = URL(URL_BASE + fn).openConnection() as HttpURLConnection
        c.requestMethod = "POST"
        c.connectTimeout = 10000; c.readTimeout = 15000
        c.setRequestProperty("apikey", KEY)
        c.setRequestProperty("Authorization", "Bearer $KEY")
        c.setRequestProperty("Content-Type", "application/json")
        c.doOutput = true
        c.outputStream.use { it.write(body.toString().toByteArray()) }
        val code = c.responseCode
        val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.readText() ?: ""
        c.disconnect()
        return try { JSONObject(text) } catch (e: Exception) { JSONObject().put("ok", false).put("error", "HTTP $code") }
    }
}
