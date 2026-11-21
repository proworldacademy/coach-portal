#!/bin/bash
# Puts the icon, the launch screen and the permission texts into the Xcode project that `npx cap add ios` generated. Run from mobile/.
set -euo pipefail
APP=ios/App/App; PLIST=$APP/Info.plist; PB=/usr/libexec/PlistBuddy
cp art/icon-1024.png "$APP/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
for f in "$APP"/Assets.xcassets/Splash.imageset/*.png; do cp art/splash-2732.png "$f"; done
# plutil takes the text as it is. PlistBuddy read an apostrophe as an open quote ("Parse Error: Unclosed Quotes") and left the camera
# and photo texts out without stopping the build: iOS then closed the app the moment the camera opened (found Nov 21, 2026).
put() { plutil -replace "$1" "-$2" "$3" "$PLIST"; }
put CFBundleDisplayName string "ProWorld"
put ITSAppUsesNonExemptEncryption bool false
put NSMicrophoneUsageDescription string "ProWorld uses the microphone when you call a family or someone on the team from the app."
put NSCameraUsageDescription string "ProWorld uses the camera for a video call with the team, and when you add a photo or a video to a message or a player page."
put NSPhotoLibraryUsageDescription string "ProWorld opens your photos when you add a photo or a video to a message or a player page."
put NSPhotoLibraryAddUsageDescription string "ProWorld saves a photo or a file from a chat to your photos when you ask it to."
# the build stops here if any permission text is missing: without one, iOS closes the app when that feature is used
for k in NSMicrophoneUsageDescription NSCameraUsageDescription NSPhotoLibraryUsageDescription NSPhotoLibraryAddUsageDescription; do
  v=$(plutil -extract "$k" raw "$PLIST") || { echo "MISSING $k in Info.plist"; exit 1; }; [ -n "$v" ] || { echo "EMPTY $k"; exit 1; }; echo "ok $k"
done
# A call with the team (Nov 15, 2026) keeps its sound when the screen locks or another app is opened.
$PB -c "Delete :UIBackgroundModes" "$PLIST" 2>/dev/null || true
$PB -c "Add :UIBackgroundModes array" "$PLIST"; $PB -c "Add :UIBackgroundModes:0 string audio" "$PLIST"
$PB -c "Delete :UISupportedInterfaceOrientations" "$PLIST" 2>/dev/null || true
$PB -c "Add :UISupportedInterfaceOrientations array" "$PLIST"; $PB -c "Add :UISupportedInterfaceOrientations:0 string UIInterfaceOrientationPortrait" "$PLIST"
# Notifications (Nov 15, 2026): the push entitlement, and the two calls that hand Apple's device token to Capacitor's PushNotifications.
cat > "$APP/App.entitlements" <<'ENT'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>aps-environment</key><string>production</string>
</dict></plist>
ENT
PBX=ios/App/App.xcodeproj/project.pbxproj
grep -q "CODE_SIGN_ENTITLEMENTS" "$PBX" || sed -i '' 's#\(PRODUCT_BUNDLE_IDENTIFIER = [^;]*;\)#\1 CODE_SIGN_ENTITLEMENTS = App/App.entitlements;#' "$PBX"
python3 - "$APP/AppDelegate.swift" <<'PY'
import sys
f = sys.argv[1]; s = open(f).read()
if "capacitorDidRegisterForRemoteNotifications" not in s:
    add = """
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }
"""
    i = s.rstrip().rfind("}")
    s = s[:i] + add + "}\n"
    open(f, "w").write(s)
PY
grep -c "CODE_SIGN_ENTITLEMENTS" "$PBX"
echo "prepared: icon, launch screen, name, permissions, notifications"
