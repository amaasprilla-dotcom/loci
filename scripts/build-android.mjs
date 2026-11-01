// `npm run android`: builds the Android app (SPEC-v6-android.md) into android/Loci.apk.
// Uses Android Studio's own Java and the SDK in its usual place, so neither needs setting
// up. The first run makes the release signing key (android/loci-release.jks): back it up,
// since updates only install over an app signed with the same key.

import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const android = join(import.meta.dirname, '..', 'android')
const studioJava = 'C:\\Program Files\\Android\\Android Studio\\jbr'
const env = { ...process.env }
if (!env.JAVA_HOME && existsSync(studioJava)) env.JAVA_HOME = studioJava

const sdk = env.ANDROID_HOME ?? join(env.LOCALAPPDATA ?? '', 'Android', 'Sdk')
if (!existsSync(join(android, 'local.properties'))) {
  writeFileSync(join(android, 'local.properties'), `sdk.dir=${sdk.replaceAll('\\', '/')}\n`)
}

if (!existsSync(join(android, 'keystore.properties'))) {
  const password = randomBytes(18).toString('base64url')
  const keytool = join(env.JAVA_HOME ?? '', 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool')
  // Valid for 100 years, so it never runs out.
  execFileSync(keytool, ['-genkeypair', '-keystore', join(android, 'loci-release.jks'), '-alias', 'loci', '-keyalg', 'RSA', '-keysize', '4096', '-validity', '36500', '-dname', 'CN=Loci', '-storepass', password, '-keypass', password], { stdio: 'inherit' })
  writeFileSync(join(android, 'keystore.properties'), `storeFile=loci-release.jks\nstorePassword=${password}\nkeyAlias=loci\nkeyPassword=${password}\n`)
  console.log('Made the signing key android/loci-release.jks (password in android/keystore.properties). Back up both.')
}

const build = ['assembleRelease', '--console=plain']
// A .bat file only runs through cmd.exe.
if (process.platform === 'win32') execFileSync('cmd.exe', ['/c', join(android, 'gradlew.bat'), ...build], { cwd: android, env, stdio: 'inherit' })
else execFileSync(join(android, 'gradlew'), build, { cwd: android, env, stdio: 'inherit' })
copyFileSync(join(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'), join(android, 'Loci.apk'))
console.log('Built android/Loci.apk')
