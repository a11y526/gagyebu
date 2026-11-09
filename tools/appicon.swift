// 앱 아이콘 그리기: 크림 바탕 + 네 색 도넛 (웹 아이콘과 같은 모양)
// swift tools/appicon.swift <폴더> mac  → 16~1024.png (맥: 둥근 사각형, 둘레 여백)
import Cocoa
let out = CommandLine.arguments[1], ios = CommandLine.arguments.count > 2 && CommandLine.arguments[2] == "ios"
for s in ios ? [1024] : [16, 32, 64, 128, 256, 512, 1024] {
  let S = CGFloat(s)
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: s, pixelsHigh: s, bitsPerSample: 8, samplesPerPixel: 4,
                             hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let cream = NSColor(red: 0.973, green: 0.965, blue: 0.945, alpha: 1)
  cream.setFill()
  if ios { NSRect(x: 0, y: 0, width: S, height: S).fill() }
  else {
    let r = NSRect(x: 0, y: 0, width: S, height: S).insetBy(dx: S * 0.09, dy: S * 0.09)
    NSBezierPath(roundedRect: r, xRadius: r.width * 0.23, yRadius: r.width * 0.23).fill()
  }
  let k: CGFloat = ios ? 1.3 : 1
  let c = NSPoint(x: S / 2, y: S / 2), R = S * 0.24 * k, w = S * 0.075 * k
  let segs: [(NSColor, CGFloat, CGFloat)] = [
    (NSColor(red: 0.29, green: 0.47, blue: 0.82, alpha: 1), 60, -20),
    (NSColor(red: 0.93, green: 0.73, blue: 0.24, alpha: 1), -45, -125),
    (NSColor(red: 0.25, green: 0.64, blue: 0.25, alpha: 1), -150, -195),
    (NSColor(red: 0.82, green: 0.32, blue: 0.29, alpha: 1), 155, 85)]
  for (col, a0, a1) in segs {
    let p = NSBezierPath(); p.appendArc(withCenter: c, radius: R, startAngle: a0, endAngle: a1, clockwise: true)
    p.lineWidth = w; p.lineCapStyle = .round; col.setStroke(); p.stroke()
  }
  NSGraphicsContext.restoreGraphicsState()
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(out)/\(s).png"))
}
