package io.github.a11y526.gagyebu

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.app.Notification

object Notify {
    private const val CH = "recorded"
    fun channel(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH, "결제 기록", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "카드 결제가 가계부에 기록되면 알려 줘요"
        })
    }
    fun recorded(ctx: Context, id: String?, text: String, sub: String, food: Boolean) {
        channel(ctx)
        val nid = (id ?: text).hashCode()
        val open = PendingIntent.getActivity(ctx, nid, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val b = Notification.Builder(ctx, CH)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(text)
            .setContentText(sub)
            .setContentIntent(open)
            .setAutoCancel(true)
        if (id != null && food) {
            val together = PendingIntent.getBroadcast(ctx, nid, Intent(ctx, ActionReceiver::class.java)
                .putExtra("id", id).putExtra("nid", nid).putExtra("title", text), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            b.addAction(Notification.Action.Builder(null, "같이 먹었어요", together).build())
        }
        ctx.getSystemService(NotificationManager::class.java).notify(nid, b.build())
    }
}
