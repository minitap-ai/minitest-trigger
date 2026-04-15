interface TriggerRunRequest {
    appSlug: string;
    flowTypes?: string[];
    iosBuildId?: string;
    androidBuildId?: string;
    tenantId?: string;
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
    tenantId?: string;
}
/**
 * Upload a build artifact (iOS .ipa or Android .apk) to the Minitap API.
 */
export declare function uploadBuild(options: UploadBuildOptions): Promise<string>;
/**
 * Trigger a test run batch via the Minitap CI API.
 */
export declare function triggerRun(apiUrl: string, token: string, request: TriggerRunRequest): Promise<TriggerRunResponse>;
export {};
