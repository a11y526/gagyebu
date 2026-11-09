package io.github.a11y526.gagyebu

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.view.WindowInsets
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

// 화면은 웹앱(가계부 사이트)을 그대로 쓰고, 알림 읽기·열쇠 보관만 이 앱이 한다.
class MainActivity : Activity() {
    private lateinit var web: WebView
    private var fileCb: ValueCallback<Array<Uri>>? = null

    @SuppressLint("SetJavaScriptEnabled")
    @Suppress("DEPRECATION")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 모든 버전에서 화면 끝까지 그리고, 막대만큼은 아래에서 안쪽 여백으로 비움
        if (Build.VERSION.SDK_INT >= 30) window.setDecorFitsSystemWindows(false)
        else window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        val root = FrameLayout(this)
        root.setBackgroundColor(0xFFF8F6F1.toInt())
        web = WebView(this)
        root.addView(web)
        setContentView(root)
        // 상태 막대·내비게이션 막대만큼 안쪽으로 (안드로이드 15 전체 화면 대응)
        root.setOnApplyWindowInsetsListener { v, insets ->
            val bars = if (Build.VERSION.SDK_INT >= 30) insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
                       else null
            if (bars != null) v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            else v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            insets
        }

        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.userAgentString = web.settings.userAgentString + " GagyebuAndroid/" + BuildConfig.VERSION_NAME
        web.overScrollMode = View.OVER_SCROLL_NEVER
        web.addJavascriptInterface(Bridge(), "GagyebuAndroid")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                val u = r.url
                if (u.host == "a11y526.github.io" || u.host?.endsWith("supabase.co") == true) return false
                startActivity(Intent(Intent.ACTION_VIEW, u)); return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            // 엑셀 맞춰 보기: 파일 고르기
            override fun onShowFileChooser(v: WebView, cb: ValueCallback<Array<Uri>>, p: FileChooserParams): Boolean {
                fileCb?.onReceiveValue(null); fileCb = cb
                return try { startActivityForResult(p.createIntent(), 7); true } catch (e: Exception) { fileCb = null; false }
            }
        }
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(Api.SITE)

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 3)
        }
        checkUpdate()
    }

    override fun onSaveInstanceState(out: Bundle) { super.onSaveInstanceState(out); web.saveState(out) }
    override fun onActivityResult(req: Int, res: Int, data: Intent?) {
        if (req == 7) { fileCb?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data)); fileCb = null; return }
        super.onActivityResult(req, res, data)
    }
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // 열린 창이 있으면 웹앱이 닫고, 아니면 앱을 뒤로
        web.evaluateJavascript("(window.gbBack && window.gbBack()) ? 1 : 0") { r ->
            if (r != "1") { if (web.canGoBack()) web.goBack() else super.onBackPressed() }
        }
    }
    override fun onResume() {
        super.onResume()
        web.evaluateJavascript("window.gbAndroidChanged && window.gbAndroidChanged()", null)
    }

    fun listenerOn(): Boolean {
        val s = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: return false
        return s.contains(ComponentName(this, PayListener::class.java).flattenToString())
    }

    // 웹앱에서 부르는 것
    inner class Bridge {
        @JavascriptInterface fun version(): String = BuildConfig.VERSION_NAME
        @JavascriptInterface fun hasKey(): Boolean = Api.key(this@MainActivity) != null
        @JavascriptInterface fun setKey(k: String) { Api.setKey(this@MainActivity, k.ifBlank { null }) }
        @JavascriptInterface fun listenerOn(): Boolean = this@MainActivity.listenerOn()
        @JavascriptInterface fun openListenerSettings() {
            runOnUiThread { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
        }
        @JavascriptInterface fun log(): String = getSharedPreferences("gb", MODE_PRIVATE).getString("log", "[]") ?: "[]"
        @JavascriptInterface fun checkUpdate() { runOnUiThread { this@MainActivity.checkUpdate(force = true) } }
    }

    // GitHub 릴리스에서 새 버전 확인 (하루 한 번, 또는 설정에서 누를 때)
    private fun checkUpdate(force: Boolean = false) {
        val prefs = getSharedPreferences("gb", MODE_PRIVATE)
        val now = System.currentTimeMillis()
        if (!force && now - prefs.getLong("update_at", 0) < 86_400_000) return
        prefs.edit().putLong("update_at", now).apply()
        Thread {
            try {
                val c = URL("https://api.github.com/repos/a11y526/gagyebu/releases/latest").openConnection() as HttpURLConnection
                c.setRequestProperty("Accept", "application/vnd.github+json")
                val j = JSONObject(c.inputStream.bufferedReader().readText()); c.disconnect()
                val tag = j.optString("tag_name")   // android-v3
                val code = tag.substringAfter("android-v").toIntOrNull() ?: return@Thread
                val assets = j.optJSONArray("assets")
                var apk: String? = null
                for (i in 0 until (assets?.length() ?: 0)) { val a = assets!!.getJSONObject(i); if (a.optString("name").endsWith(".apk")) apk = a.optString("browser_download_url") }
                if (code > BuildConfig.VERSION_CODE && apk != null) runOnUiThread {
                    AlertDialog.Builder(this).setTitle("새 버전이 있어요")
                        .setMessage("1.0.$code 버전으로 업데이트할까요? 내려받은 뒤 [설치]를 누르면 돼요.")
                        .setPositiveButton("업데이트") { _, _ -> startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(apk))) }
                        .setNegativeButton("나중에", null).show()
                } else if (force) runOnUiThread {
                    AlertDialog.Builder(this).setMessage("최신 버전이에요 (${BuildConfig.VERSION_NAME})").setPositiveButton("확인", null).show()
                }
            } catch (e: Exception) { }
        }.start()
    }
}
