import type { DeviceType } from './api';
export declare function parseDeviceType(input: string, inputName: 'ios-device-type' | 'android-device-type'): DeviceType | undefined;
export declare function validateRunFlags(opts: {
    runIos: boolean;
    runAndroid: boolean;
    wantWeb: boolean;
    iosBuildPath: string;
    androidBuildPath: string;
    iosDeviceType?: DeviceType;
    androidDeviceType?: DeviceType;
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
