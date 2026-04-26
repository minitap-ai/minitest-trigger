export type Platform = 'ios' | 'android';
interface TriggerRunRequest {
    appSlug: string;
    commitTitle: string;
    userStoryTypes?: string[];
    platforms?: Platform[];
    iosBuildId?: string;
    androidBuildId?: string;
    tenantId?: string;
    prNumber?: number;
    prTitle?: string;
}
interface TriggerRunResponse {
    batchId: string;
    status: string;
    appId: string;
    appSlug: string;
}
interface UploadBuildOptions {
    apiUrl: string;
    token: string;
    buildPath: string;
    appSlug: string;
    commitTitle: string;
    commitSha: string;
    tenantId?: string;
}
/**
 * Upload a build artifact to the Minitap API.
 *
 * Accepts iOS builds (.ipa) or Android emulator builds (.apk).
 */
export declare function uploadBuild(options: UploadBuildOptions): Promise<string>;
/**
 * Trigger a test run batch via the Minitap CI API.
 */
export declare function triggerRun(apiUrl: string, token: string, request: TriggerRunRequest): Promise<TriggerRunResponse>;
export {};
