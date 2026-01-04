export type TranslationKey =
    // Status Bar
    | 'status.initializing'
    | 'status.detecting'
    | 'status.fetching'
    | 'status.retrying'
    | 'status.error'
    | 'status.refreshing'
    | 'status.notLoggedIn'
    | 'status.loggingIn'
    | 'status.loginExpired'
    | 'status.stale'

    // Tooltip
    | 'tooltip.title'
    | 'tooltip.credits'
    | 'tooltip.available'
    | 'tooltip.remaining'
    | 'tooltip.depleted'
    | 'tooltip.resetTime'
    | 'tooltip.model'
    | 'tooltip.status'
    | 'tooltip.error'
    | 'tooltip.clickToRetry'
    | 'tooltip.clickToLogin'
    | 'tooltip.clickToRelogin'
    | 'tooltip.staleWarning'

    // Notifications (vscode.window.show*Message)
    | 'notify.unableToDetectProcess'
    | 'notify.retry'
    | 'notify.cancel'
    | 'notify.refreshingQuota'
    | 'notify.detectionSuccess'
    | 'notify.unableToDetectPort'
    | 'notify.unableToDetectPortHint1'
    | 'notify.unableToDetectPortHint2'
    | 'notify.portDetectionFailed'
    | 'notify.configUpdated'
    | 'notify.nonAntigravityDetected'
    | 'notify.switchToGoogleApi'
    | 'notify.keepLocalApi'
    | 'notify.neverShowAgain'
    | 'notify.portCommandRequired'
    | 'notify.portCommandRequiredDarwin'
    | 'notify.googleApiNoPortDetection'

    // Login errors
    | 'login.error.serviceNotInitialized'
    | 'login.error.authFailed';

export interface TranslationMap {
    [key: string]: string;
}
