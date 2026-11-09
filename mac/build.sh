#!/bin/zsh
# 맥 앱 만들기: ./mac/build.sh → 우리가계부/우리 가계부.app (응용 프로그램 폴더로 끌어다 놓으면 됨)
set -e
HERE=${0:A:h}
ROOT=${HERE:h}
APP="$ROOT/우리 가계부.app"
VER=${VER:-1.0}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

swiftc -O -parse-as-library -swift-version 5 -target arm64-apple-macos13.0 \
  -o "$TMP/Gagyebu" "$HERE/GagyebuMac.swift" -framework Cocoa -framework WebKit

mkdir -p "$TMP/png" "$TMP/AppIcon.iconset"
swift "$ROOT/tools/appicon.swift" "$TMP/png" mac
for s in 16 32 128 256 512; do
  cp "$TMP/png/$s.png" "$TMP/AppIcon.iconset/icon_${s}x${s}.png"
  cp "$TMP/png/$((s*2)).png" "$TMP/AppIcon.iconset/icon_${s}x${s}@2x.png"
done
iconutil -c icns "$TMP/AppIcon.iconset" -o "$TMP/AppIcon.icns"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$TMP/Gagyebu" "$APP/Contents/MacOS/Gagyebu"
cp "$TMP/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>우리 가계부</string>
  <key>CFBundleDisplayName</key><string>우리 가계부</string>
  <key>CFBundleIdentifier</key><string>io.github.a11y526.gagyebu.mac</string>
  <key>CFBundleExecutable</key><string>Gagyebu</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VER</string>
  <key>CFBundleVersion</key><string>$(date +%Y%m%d%H%M)</string>
  <key>CFBundleDevelopmentRegion</key><string>ko</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.finance</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>우리 가계부</string>
</dict></plist>
PLIST
codesign --force --deep -s - "$APP"
echo "만듦: $APP"
