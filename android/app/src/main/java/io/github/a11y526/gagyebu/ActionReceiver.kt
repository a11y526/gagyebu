package io.github.a11y526.gagyebu

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject

// '기록됨' 알림의 [같이 먹었어요] → 같이 먹은 기록으로 옮김
class ActionReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val id = intent.getStringExtra("id") ?: return
        val nid = intent.getIntExtra("nid", 0)
        val title = intent.getStringExtra("title") ?: "결제"
        val key = Api.key(ctx) ?: return
        val pending = goAsync()
        Thread {
            try {
                val r = Api.rpc("gb_phone_set_split", JSONObject().put("p_key", key).put("p_id", id).put("p_split", "together"))
                ctx.getSystemService(NotificationManager::class.java).cancel(nid)
                Notify.recorded(ctx, null, title.replace(" 기록됨", ""), if (r.optBoolean("ok")) "같이 먹은 기록으로 옮겼어요" else "옮기지 못했어요. 앱에서 바꿔 주세요", false)
            } finally { pending.finish() }
        }.start()
    }
}
