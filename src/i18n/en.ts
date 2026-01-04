import { TranslationMap } from './types';

export const en: TranslationMap = {
    // Status Bar
    'status.initializing': '⏳ Initializing...',
    'status.detecting': '🔍 Detecting port...',
    'status.fetching': '$(sync~spin) Fetching quota...',
    'status.retrying': '$(sync~spin) Retrying ({current}/{max})...',
    'status.error': '$(error) Antigravity Quota Watcher: Error',
    'status.refreshing': '$(sync~spin) Refreshing...',
    'status.notLoggedIn': '$(account) Not logged in, click to login',
    'status.loggingIn': '$(sync~spin) Logging in...',
    'status.loginExpired': '$(warning) Login expired, click to re-login',
    'status.stale': '⏸️',

    // Tooltip
    'tooltip.title': '**Antigravity Model Quota**', // Markdown bold
    'tooltip.credits': '💳 **Prompt Credits**',
    'tooltip.available': 'Available',
    'tooltip.remaining': 'Remaining',
    'tooltip.depleted': '⚠️ **Depleted**',
    'tooltip.resetTime': 'Reset',
    'tooltip.model': 'Model',
    'tooltip.status': 'Status',
    'tooltip.error': 'Error fetching quota information.',
    'tooltip.clickToRetry': 'Click to retry',
    'tooltip.clickToLogin': 'Click to login with Google',
    'tooltip.clickToRelogin': 'Login expired, click to re-login',
    'tooltip.staleWarning': '⚠️ Data may be outdated (network issue or timeout)',

    // Notifications (vscode.window.show*Message)
    'notify.unableToDetectProcess': 'Antigravity Quota Watcher: Unable to detect the Antigravity process.',
    'notify.retry': 'Retry',
    'notify.cancel': 'Cancel',
    'notify.refreshingQuota': '🔄 Refreshing quota...',
    'notify.detectionSuccess': '✅ Detection successful! Port: {port}',
    'notify.unableToDetectPort': '❌ Unable to detect a valid port. Please ensure:',
    'notify.unableToDetectPortHint1': '1. Your Google account is signed in',
    'notify.unableToDetectPortHint2': '2. The system has permission to run the detection commands',
    'notify.portDetectionFailed': '❌ Port detection failed: {error}',
    'notify.configUpdated': 'Antigravity Quota Watcher config updated',
    'notify.nonAntigravityDetected': 'Non-Antigravity IDE detected. Recommended to use Google API to fetch quota.',
    'notify.switchToGoogleApi': 'Switch',
    'notify.keepLocalApi': 'Keep current',
    'notify.neverShowAgain': 'Never show again',
    'notify.portCommandRequired': 'Port detection requires lsof, ss, or netstat. Please install one of them',
    'notify.portCommandRequiredDarwin': 'Port detection requires lsof or netstat. Please install one of them',
    'notify.googleApiNoPortDetection': 'Google API method does not require port detection. Please use Google Login instead.',

    // Login errors
    'login.error.serviceNotInitialized': 'Auth service not initialized',
    'login.error.authFailed': 'Authentication failed'
};
