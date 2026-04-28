/**
 * Validate the run-flags / build-path input combination.
 *
 * Rules:
 *  1. At least one of `run-ios` / `run-android` must be true.
 *  2. A build path can only be supplied for a platform that is enabled —
 *     otherwise the artifact would be uploaded but never tested.
 */
export declare function validateRunFlags(opts: {
    runIos: boolean;
    runAndroid: boolean;
    iosBuildPath: string;
    androidBuildPath: string;
}): void;
/**
 * Validate an Android build artifact.
 *
 * Checks:
 * 1. File exists and has a .apk extension
 * 2. APK contains native libraries for x86_64 architecture (lib/x86_64/)
 *
 * @returns The validated build path (unchanged).
 */
export declare function validateAndroidBuild(buildPath: string): string;
/**
 * Validate an iOS build artifact.
 *
 * Accepts:
 * - A .app directory (simulator bundle) — packaged into a .ipa before upload
 * - A .ipa file — uploaded as-is
 *
 * @returns The path to upload (may be a newly-created temp .ipa file).
 */
export declare function validateIosBuild(buildPath: string): string;
