# The ProWorld Academy app (App Store)

A native shell (Capacitor) around the live site, https://proworld-coach-portal.web.app. The site is the app: what is published to
Firebase is what the app shows, the same minute. A new App Store build is needed only when the shell changes (icon, name, permissions).

- Store name: **ProWorld Academy** · under the icon: **ProWorld** · bundle id: `com.proworldacademy.app` · Apple team `PDHM2GBBB6`
- Built and sent to TestFlight by `.github/workflows/ios.yml` on a GitHub Mac. Nothing to install on anyone's computer.
- The upload key is the repository secret `ASC_KEY_P8` (never in a file, never in a chat). Key id and issuer id are not secret.
- `asc.js` registers the bundle id and says whether the app exists in App Store Connect (Apple lets only a person create it).
- `prepare-ios.sh` puts the icon, the launch screen and the permissions texts into the generated Xcode project.
- The `ios/` folder is generated at build time (`npx cap add ios`) and is not kept in the repository.
- `mobile/` is not published with the site (firebase.json ignores it).

To build again: change `mobile/build.txt` (any text) and push to the branch the workflow watches, or run it by hand from Actions.
