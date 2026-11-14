#!/bin/bash
# Puts the icon, the launch screen and the permission texts into the Xcode project that `npx cap add ios` generated. Run from mobile/.
set -euo pipefail
APP=ios/App/App; PLIST=$APP/Info.plist; PB=/usr/libexec/PlistBuddy
cp art/icon-1024.png "$APP/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
for f in "$APP"/Assets.xcassets/Splash.imageset/*.png; do cp art/splash-2732.png "$f"; done
put() { $PB -c "Delete :$1" "$PLIST" 2>/dev/null || true; $PB -c "Add :$1 $2 $3" "$PLIST"; }
put CFBundleDisplayName string "ProWorld"
put ITSAppUsesNonExemptEncryption bool false
put NSMicrophoneUsageDescription string "ProWorld uses the microphone when you call a family from the app."
put NSCameraUsageDescription string "ProWorld uses the camera when you add a photo or a video to a player's page."
put NSPhotoLibraryUsageDescription string "ProWorld opens your photos when you add a photo or a video to a player's page."
$PB -c "Delete :UISupportedInterfaceOrientations" "$PLIST" 2>/dev/null || true
$PB -c "Add :UISupportedInterfaceOrientations array" "$PLIST"; $PB -c "Add :UISupportedInterfaceOrientations:0 string UIInterfaceOrientationPortrait" "$PLIST"
echo "prepared: icon, launch screen, name, permissions"
