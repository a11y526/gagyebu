package io.github.a11y526.gagyebu

// 카드·은행 알림 글 → 결제 한 건 (모르는 형식이면 null)
data class Pay(val amt: Int, val place: String, val cancel: Boolean)

object PayParser {
    /** 읽을 앱: 삼성카드·BC카드(페이북)·케이뱅크, 그리고 문자 앱(카드 승인 문자) */
    private val cardApps = listOf("samsungcard", "bccard", "paybooc", "kbank")
    private val smsApps = listOf("messaging", "mms", "sms", "message")

    fun accepts(pkg: String): Boolean = cardApps.any { pkg.contains(it) } || smsApps.any { pkg.contains(it) }
    fun isSms(pkg: String): Boolean = smsApps.any { pkg.contains(it) } && cardApps.none { pkg.contains(it) }

    private val amountRe = Regex("""(\d{1,3}(?:,\d{3})+|\d+)\s*원""")
    private val timeRe = Regex("""\d{1,2}:\d{2}""")

    fun parse(pkg: String, raw: String): Pay? {
        val t = raw.replace(Regex("""\s+"""), " ").trim()
        if (isSms(pkg) && !t.contains("카드")) return null
        if (!(t.contains("승인") || t.contains("결제") || t.contains("사용"))) return null
        if (listOf("거절", "실패", "한도", "예정", "청구", "명세서", "출금예정").any { t.contains(it) }) return null
        val cancel = t.contains("취소")
        // 금액: '누적'·'잔액' 바로 뒤 숫자는 건너뜀
        val amt = amountRe.findAll(t).firstOrNull { m ->
            val before = t.substring(maxOf(0, m.range.first - 6), m.range.first)
            !before.contains("누적") && !before.contains("잔액") && !before.contains("한도")
        }?.groupValues?.get(1)?.replace(",", "")?.toIntOrNull() ?: return null
        if (amt <= 0) return null
        // 가게: 시각(12:30) 뒤 글자 → '누적'·'잔액' 앞까지
        var place = ""
        timeRe.findAll(t).lastOrNull()?.let { m ->
            place = t.substring(m.range.last + 1).split("누적", "잔액", "[", "(누적").first().trim()
        }
        if (place.isEmpty()) {
            // 시각이 없으면 금액 뒤 글자에서 할부 표시 빼고
            val m = amountRe.find(t)
            if (m != null) place = t.substring(m.range.last + 1).replace(Regex("""일시불|할부\s*\d*개월|승인|취소|결제|사용"""), "").split("누적", "잔액").first().trim()
        }
        place = place.replace(Regex("""^[\s·:,-]+"""), "").take(40)
        return Pay(amt, place, cancel)
    }
}
