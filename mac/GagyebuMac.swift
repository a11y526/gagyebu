// 우리 가계부 맥 앱: 화면은 웹앱(가계부 사이트)을 그대로 쓴다. 갤럭시 앱과 같은 방식.
import Cocoa
import WebKit

let SITE = URL(string: "https://a11y526.github.io/gagyebu/")!
let CREAM = NSColor(red: 0.973, green: 0.965, blue: 0.945, alpha: 1)   // #F8F6F1

@main
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var web: WKWebView!

    static func main() {
        let app = NSApplication.shared
        let d = AppDelegate()
        app.delegate = d
        app.setActivationPolicy(.regular)
        app.run()
    }

    func applicationDidFinishLaunching(_ n: Notification) {
        buildMenu()
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()   // 로그인 유지
        cfg.applicationNameForUserAgent = "Version/26.0 Safari/605.1.15 GagyebuMac/" + Self.version
        cfg.preferences.setValue(true, forKey: "developerExtrasEnabled")   // 오른쪽 클릭 → 요소 검사
        web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = false
        web.allowsMagnification = true
        web.underPageBackgroundColor = CREAM
        web.load(URLRequest(url: SITE))

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1240, height: 820),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "우리 가계부"
        window.titlebarAppearsTransparent = true
        window.backgroundColor = CREAM
        window.minSize = NSSize(width: 380, height: 560)
        window.contentView = web
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("Main")   // 창 크기·위치 기억
        if !window.setFrameUsingName("Main") { window.center() }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    static var version: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0" }

    // 창을 닫아도 앱은 남고, 독 아이콘을 누르면 다시 보임
    func applicationShouldHandleReopen(_ s: NSApplication, hasVisibleWindows v: Bool) -> Bool {
        if !v { window.makeKeyAndOrderFront(nil) }
        return true
    }

    // ───────── 메뉴 ─────────
    func buildMenu() {
        let main = NSMenu()
        func sub(_ title: String, _ items: [NSMenuItem]) {
            let m = NSMenu(title: title); items.forEach(m.addItem)
            let it = NSMenuItem(); it.submenu = m; main.addItem(it)
        }
        func item(_ t: String, _ a: Selector?, _ k: String, _ mod: NSEvent.ModifierFlags = .command) -> NSMenuItem {
            let i = NSMenuItem(title: t, action: a, keyEquivalent: k); i.keyEquivalentModifierMask = mod; return i
        }
        sub("우리 가계부", [
            item("우리 가계부에 관하여", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""),
            .separator(),
            item("우리 가계부 가리기", #selector(NSApplication.hide(_:)), "h"),
            item("기타 가리기", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            .separator(),
            item("우리 가계부 종료", #selector(NSApplication.terminate(_:)), "q"),
        ])
        sub("편집", [
            item("실행 취소", Selector(("undo:")), "z"),
            item("실행 복귀", Selector(("redo:")), "z", [.command, .shift]),
            .separator(),
            item("오려두기", #selector(NSText.cut(_:)), "x"),
            item("복사하기", #selector(NSText.copy(_:)), "c"),
            item("붙여넣기", #selector(NSText.paste(_:)), "v"),
            item("전체 선택", #selector(NSText.selectAll(_:)), "a"),
        ])
        sub("보기", [
            item("새로 고침", #selector(reload), "r"),
            .separator(),
            item("실제 크기", #selector(zoomReset), "0"),
            item("확대", #selector(zoomIn), "+"),
            item("축소", #selector(zoomOut), "-"),
            .separator(),
            item("전체 화면", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ])
        sub("윈도우", [
            item("최소화", #selector(NSWindow.performMiniaturize(_:)), "m"),
            item("확대/축소", #selector(NSWindow.performZoom(_:)), ""),
            item("가계부 창", #selector(showMain), "1"),
        ])
        NSApp.mainMenu = main
    }
    @objc func reload() { if web.url?.host == SITE.host { web.reload() } else { web.load(URLRequest(url: SITE)) } }
    @objc func showMain() { window.makeKeyAndOrderFront(nil) }
    @objc func zoomReset() { web.pageZoom = 1 }
    @objc func zoomIn() { web.pageZoom = min(web.pageZoom + 0.1, 2) }
    @objc func zoomOut() { web.pageZoom = max(web.pageZoom - 0.1, 0.6) }

    // ───────── 웹 화면 ─────────
    // 가계부·Supabase 주소는 앱 안에서, 나머지 링크는 기본 브라우저로
    func webView(_ v: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler h: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let u = a.request.url, let host = u.host else { h(.allow); return }
        if host == SITE.host || host.hasSuffix("supabase.co") || a.targetFrame?.isMainFrame == false { h(.allow); return }
        NSWorkspace.shared.open(u); h(.cancel)
    }
    // target=_blank 링크
    func webView(_ v: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures f: WKWindowFeatures) -> WKWebView? {
        if let u = a.request.url { NSWorkspace.shared.open(u) }
        return nil
    }
    // 인터넷이 끊겼을 때
    func webView(_ v: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { offline(e) }
    func offline(_ e: Error) {
        if (e as NSError).code == NSURLErrorCancelled { return }
        let html = """
        <meta name=viewport content="width=device-width"><body style="margin:0;height:100vh;display:grid;place-items:center;background:#F8F6F1;font:15px -apple-system;color:#555;text-align:center">
        <div><div style="font-size:20px;font-weight:700;color:#222;margin-bottom:8px">연결할 수 없어요</div>인터넷 연결을 확인하고<br>⌘R로 다시 불러 주세요.</div></body>
        """
        web.loadHTMLString(html, baseURL: nil)
    }
    // 웹 콘텐츠 프로세스가 죽으면 다시 불러오기
    func webViewWebContentProcessDidTerminate(_ v: WKWebView) { v.load(URLRequest(url: SITE)) }

    // confirm / alert / 파일 고르기 (엑셀 맞춰 보기)
    func webView(_ v: WKWebView, runJavaScriptAlertPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler h: @escaping () -> Void) {
        let al = NSAlert(); al.messageText = m; al.addButton(withTitle: "확인")
        al.beginSheetModal(for: window) { _ in h() }
    }
    func webView(_ v: WKWebView, runJavaScriptConfirmPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler h: @escaping (Bool) -> Void) {
        let al = NSAlert(); al.messageText = m
        al.addButton(withTitle: "확인"); al.addButton(withTitle: "취소")
        al.beginSheetModal(for: window) { h($0 == .alertFirstButtonReturn) }
    }
    func webView(_ v: WKWebView, runJavaScriptTextInputPanelWithPrompt p: String, defaultText d: String?, initiatedByFrame f: WKFrameInfo, completionHandler h: @escaping (String?) -> Void) {
        let al = NSAlert(); al.messageText = p
        let tf = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24)); tf.stringValue = d ?? ""
        al.accessoryView = tf; al.addButton(withTitle: "확인"); al.addButton(withTitle: "취소")
        al.beginSheetModal(for: window) { h($0 == .alertFirstButtonReturn ? tf.stringValue : nil) }
    }
    func webView(_ v: WKWebView, runOpenPanelWith p: WKOpenPanelParameters, initiatedByFrame f: WKFrameInfo, completionHandler h: @escaping ([URL]?) -> Void) {
        let op = NSOpenPanel()
        op.allowsMultipleSelection = p.allowsMultipleSelection
        op.canChooseDirectories = false
        op.beginSheetModal(for: window) { h($0 == .OK ? op.urls : nil) }
    }
}
