import * as core from '@actions/core'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'

/**
 * Validate the run-flags / build-path input combination.
 *
 * Rules:
 *  1. At least one of `run-ios` / `run-android` must be true.
 *  2. A build path can only be supplied for a platform that is enabled —
 *     otherwise the artifact would be uploaded but never tested.
 */
export function validateRunFlags(opts: {
  runIos: boolean
  runAndroid: boolean
  iosBuildPath: string
  androidBuildPath: string
}): void {
  const { runIos, runAndroid, iosBuildPath, androidBuildPath } = opts

  if (!runIos && !runAndroid) {
    throw new Error(
      'Nothing to run: both `run-ios` and `run-android` are false.\n' +
        '  Enable at least one platform.',
    )
  }

  if (!runIos && iosBuildPath) {
    throw new Error(
      '`ios-build-path` was provided but `run-ios` is false.\n' +
        '  Either set `run-ios: true` or remove `ios-build-path`.',
    )
  }

  if (!runAndroid && androidBuildPath) {
    throw new Error(
      '`android-build-path` was provided but `run-android` is false.\n' +
        '  Either set `run-android: true` or remove `android-build-path`.',
    )
  }
}

/**
 * Validate an Android build artifact.
 *
 * Checks:
 * 1. File exists and has a .apk extension
 * 2. APK contains native libraries for x86_64 architecture (lib/x86_64/)
 *
 * @returns The validated build path (unchanged).
 */
export function validateAndroidBuild(buildPath: string): string {
  const absolutePath = path.resolve(buildPath)

  // Check existence
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Android build file not found: ${absolutePath}`)
  }

  // Check extension
  if (!absolutePath.endsWith('.apk')) {
    throw new Error(
      `Android build must be a .apk file.\n` +
        `  Got: ${path.basename(absolutePath)}\n` +
        `  Hint: Provide the path to your debug/release .apk built for x86-64 emulators.`,
    )
  }

  // Check it's a file, not a directory
  const stat = fs.statSync(absolutePath)
  if (!stat.isFile()) {
    throw new Error(
      `Android build path is not a file: ${absolutePath}\n` +
        `  Expected a .apk file, but found a directory.`,
    )
  }

  // Inspect APK contents for x86_64 native libraries
  core.info('Validating Android build architecture (x86-64)...')
  try {
    const listing = execFileSync('unzip', ['-l', absolutePath], {
      encoding: 'utf-8',
      timeout: 60_000,
    })

    // Check what architectures are present
    const archDirs = new Set<string>()
    for (const line of listing.split('\n')) {
      const match = line.match(/\blib\/([\w-]+)\//)
      if (match) archDirs.add(match[1])
    }

    if (archDirs.size === 0) {
      // Pure Java/Kotlin app — no native libraries, runs on any architecture
      core.info(
        '✓ Android build has no native libraries — compatible with all architectures',
      )
    } else if (archDirs.has('x86_64')) {
      core.info('✓ Android build contains x86_64 native libraries')
    } else {
      // Has native libs but not for x86_64
      throw new Error(
        `Android build must target x86-64 emulators.\n` +
          `  Found architectures: ${[...archDirs].join(', ')}\n` +
          `  The APK at "${path.basename(absolutePath)}" does not contain native libraries for x86_64.\n` +
          `  Hint: Build your app for x86_64 (e.g., with an x86-64 emulator target or ABI filter).`,
      )
    }
  } catch (error) {
    // Re-throw our own validation errors
    if (error instanceof Error && error.message.includes('x86-64 emulators')) {
      throw error
    }
    // unzip command failed — maybe the file isn't a valid ZIP/APK
    throw new Error(
      `Failed to inspect Android APK: ${absolutePath}\n` +
        `  The file may be corrupted or not a valid APK.\n` +
        `  Error: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  return absolutePath
}

/**
 * Validate an iOS build artifact.
 *
 * Accepts:
 * - A .app directory (simulator bundle) — packaged into a .ipa before upload
 * - A .ipa file — uploaded as-is
 *
 * @returns The path to upload (may be a newly-created temp .ipa file).
 */
export function validateIosBuild(buildPath: string): string {
  const absolutePath = path.resolve(buildPath)

  // ── .ipa file ──────────────────────────────────────────────────────
  if (absolutePath.endsWith('.ipa')) {
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`iOS build file not found: ${absolutePath}`)
    }

    const stat = fs.statSync(absolutePath)
    if (!stat.isFile()) {
      throw new Error(
        `iOS build path is not a file: ${absolutePath}\n` +
          `  Expected a .ipa file, but found a directory.`,
      )
    }

    core.info('✓ iOS build is a .ipa file — will upload as-is')
    return absolutePath
  }

  // ── .app directory (simulator bundle) ──────────────────────────────
  if (absolutePath.endsWith('.app')) {
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`iOS build not found: ${absolutePath}`)
    }

    const stat = fs.statSync(absolutePath)
    if (!stat.isDirectory()) {
      throw new Error(
        `iOS build path is not a directory: ${absolutePath}\n` +
          `  A .app path must be a simulator bundle directory, not a file.`,
      )
    }

    // Validate it's a proper app bundle
    const infoPlist = path.join(absolutePath, 'Info.plist')
    if (!fs.existsSync(infoPlist)) {
      throw new Error(
        `iOS build does not appear to be a valid .app bundle: ${absolutePath}\n` +
          `  Missing Info.plist inside the .app directory.\n` +
          `  Hint: Ensure you're pointing to the actual .app simulator bundle.`,
      )
    }

    // Package the .app bundle into a .ipa for upload
    // IPA structure: Payload/<AppName>.app/
    core.info('Packaging iOS .app bundle into .ipa for upload...')
    const appName = path.basename(absolutePath)
    const ipaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minitap-ipa-'))
    const payloadDir = path.join(ipaDir, 'Payload')
    const ipaPath = path.join(
      os.tmpdir(),
      `${path.basename(appName, '.app')}-${Date.now()}.ipa`,
    )

    try {
      // Create Payload directory and copy .app into it
      fs.mkdirSync(payloadDir)
      execFileSync('cp', ['-R', absolutePath, payloadDir], {
        timeout: 300_000,
      })

      // Zip Payload/ into .ipa
      execFileSync('zip', ['-r', '-q', ipaPath, 'Payload'], {
        cwd: ipaDir,
        timeout: 300_000,
      })
    } catch (error) {
      throw new Error(
        `Failed to package iOS .app bundle into .ipa: ${absolutePath}\n` +
          `  Error: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      // Clean up temp Payload directory
      fs.rmSync(ipaDir, { recursive: true, force: true })
    }

    const ipaStat = fs.statSync(ipaPath)
    core.info(
      `✓ iOS .app bundle packaged into .ipa (${formatBytes(ipaStat.size)}) → ${path.basename(ipaPath)}`,
    )

    return ipaPath
  }

  // ── Unsupported format ─────────────────────────────────────────────
  throw new Error(
    `iOS build must be a .app simulator bundle (directory) or a .ipa file.\n` +
      `  Got: "${path.basename(absolutePath)}"\n` +
      `  Hint: Build your app for the iOS Simulator and provide the .app output directory,\n` +
      `         or provide a .ipa file directly.`,
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
