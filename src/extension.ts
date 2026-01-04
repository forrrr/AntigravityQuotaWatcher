/**
 * Antigravity Quota Watcher - main extension file
 */

import * as vscode from 'vscode';
import { QuotaService, QuotaApiMethod } from './quotaService';
import { StatusBarService } from './statusBar';
import { ConfigService } from './configService';
import { PortDetectionService, PortDetectionResult } from './portDetectionService';
import { Config, QuotaSnapshot } from './types';
import { LocalizationService } from './i18n/localizationService';
import { versionInfo } from './versionInfo';
import { registerDevCommands } from './devTools';
import { GoogleAuthService, AuthState, AuthStateInfo } from './auth';

let quotaService: QuotaService | undefined;
let statusBarService: StatusBarService | undefined;
let configService: ConfigService | undefined;
let portDetectionService: PortDetectionService | undefined;
let googleAuthService: GoogleAuthService | undefined;
let configChangeTimer: NodeJS.Timeout | undefined;  // 配置变更防抖定时器
let lastFocusRefreshTime: number = 0;  // 上次焦点刷新时间戳
const FOCUS_REFRESH_THROTTLE_MS = 3000;  // 焦点刷新节流阈值

/**
 * Called when the extension is activated
 */
export async function activate(context: vscode.ExtensionContext) {
  // Initialize and print version info
  versionInfo.initialize(context);
  console.log(`=== Antigravity Quota Watcher v${versionInfo.getExtensionVersion()} ===`);
  console.log(`Running on: ${versionInfo.getIdeName()} v${versionInfo.getIdeVersion()}`);

  // Init services
  configService = new ConfigService();
  let config = configService.getConfig();

  // Initialize localization
  const localizationService = LocalizationService.getInstance();
  localizationService.setLanguage(config.language);

  // Init status bar
  statusBarService = new StatusBarService(
    config.warningThreshold,
    config.criticalThreshold,
    config.showPromptCredits,
    config.showPlanName,
    config.showGeminiPro,
    config.showGeminiFlash,
    config.displayStyle
  );

  // Initialize Google Auth Service (always needed for login commands)
  googleAuthService = GoogleAuthService.getInstance();
  await googleAuthService.initialize(context);

  // 根据 API 方法选择不同的初始化路径
  const apiMethod = getApiMethodFromConfig(config.apiMethod);

  if (apiMethod === QuotaApiMethod.GOOGLE_API) {
    // GOOGLE_API 方法：只需要 Google Auth，不需要端口检测
    await initializeGoogleApiMethod(context, config, localizationService);
  } else {
    // 本地 API 方法 (GET_USER_STATUS / COMMAND_MODEL_CONFIG)：需要端口检测
    await initializeLocalApiMethod(context, config, localizationService);
  }

  // Command: show quota details (placeholder)
  const showQuotaCommand = vscode.commands.registerCommand(
    'antigravity-quota-watcher.showQuota',
    () => {
      // TODO: implement quota detail panel
    }
  );

  // Command: quick refresh quota (for success state)
  const quickRefreshQuotaCommand = vscode.commands.registerCommand(
    'antigravity-quota-watcher.quickRefreshQuota',
    async () => {
      console.log('[Extension] quickRefreshQuota command invoked');
      if (!quotaService) {
        // quotaService 未初始化，自动委托给 detectPort 命令进行重新检测
        console.log('[Extension] quotaService not initialized, delegating to detectPort command');
        await vscode.commands.executeCommand('antigravity-quota-watcher.detectPort');
        return;
      }

      console.log('User triggered quick quota refresh');
      // 显示刷新中状态(旋转图标)
      statusBarService?.showQuickRefreshing();
      // 立即刷新一次,不中断轮询
      await quotaService.quickRefresh();
    }
  );

  // Command: refresh quota
  const refreshQuotaCommand = vscode.commands.registerCommand(
    'antigravity-quota-watcher.refreshQuota',
    async () => {
      console.log('[Extension] refreshQuota command invoked');
      if (!quotaService) {
        // quotaService 未初始化，自动委托给 detectPort 命令进行重新检测
        console.log('[Extension] quotaService not initialized, delegating to detectPort command');
        await vscode.commands.executeCommand('antigravity-quota-watcher.detectPort');
        return;
      }

      vscode.window.showInformationMessage(localizationService.t('notify.refreshingQuota'));
      config = configService!.getConfig();
      statusBarService?.setWarningThreshold(config.warningThreshold);
      statusBarService?.setCriticalThreshold(config.criticalThreshold);
      statusBarService?.setShowPromptCredits(config.showPromptCredits);
      statusBarService?.setShowPlanName(config.showPlanName);
      statusBarService?.setShowGeminiPro(config.showGeminiPro);
      statusBarService?.setShowGeminiFlash(config.showGeminiFlash);
      statusBarService?.setDisplayStyle(config.displayStyle);
      statusBarService?.showFetching();

      if (config.enabled) {
        quotaService.setApiMethod(getApiMethodFromConfig(config.apiMethod));
        // 使用新的重试方法,成功后会自动恢复轮询
        await quotaService.retryFromError(config.pollingInterval);
      }
    }
  );

  // Command: re-detect port
  const detectPortCommand = vscode.commands.registerCommand(
    'antigravity-quota-watcher.detectPort',
    async () => {
      console.log('[Extension] detectPort command invoked');

      config = configService!.getConfig();
      const currentApiMethod = getApiMethodFromConfig(config.apiMethod);

      // GOOGLE_API 方法不需要端口检测
      if (currentApiMethod === QuotaApiMethod.GOOGLE_API) {
        console.log('[Extension] detectPort: GOOGLE_API method does not need port detection');
        vscode.window.showInformationMessage(
          localizationService.t('notify.googleApiNoPortDetection') ||
          'Google API method does not require port detection. Please use Google Login instead.'
        );
        return;
      }

      // 确保 portDetectionService 已初始化
      if (!portDetectionService) {
        portDetectionService = new PortDetectionService(context);
      }

      // 使用状态栏显示检测状态，不弹窗
      statusBarService?.showDetecting();

      statusBarService?.setWarningThreshold(config.warningThreshold);
      statusBarService?.setCriticalThreshold(config.criticalThreshold);
      statusBarService?.setShowPromptCredits(config.showPromptCredits);
      statusBarService?.setShowPlanName(config.showPlanName);
      statusBarService?.setShowGeminiPro(config.showGeminiPro);
      statusBarService?.setShowGeminiFlash(config.showGeminiFlash);
      statusBarService?.setDisplayStyle(config.displayStyle);

      try {
        console.log('[Extension] detectPort: invoking portDetectionService');
        const result = await portDetectionService?.detectPort();

        if (result && result.port && result.csrfToken) {
          console.log('[Extension] detectPort command succeeded:', result);
          // 如果之前没有 quotaService,需要初始化
          if (!quotaService) {
            quotaService = new QuotaService(result.port, result.csrfToken, result.httpPort);
            quotaService.setPorts(result.connectPort, result.httpPort);

            // 注册回调
            quotaService.onQuotaUpdate((snapshot: QuotaSnapshot) => {
              statusBarService?.updateDisplay(snapshot);
            });

            quotaService.onError((error: Error) => {
              console.error('Quota fetch failed:', error);
              statusBarService?.showError(`Connection failed: ${error.message}`);
            });

            // Register auth status callback (for GOOGLE_API method)
            quotaService.onAuthStatus((needsLogin: boolean, isExpired: boolean) => {
              if (needsLogin) {
                if (isExpired) {
                  statusBarService?.showLoginExpired();
                } else {
                  statusBarService?.showNotLoggedIn();
                }
              }
            });

          } else {
            // 更新现有服务的端口
            quotaService.setPorts(result.connectPort, result.httpPort);
            quotaService.setAuthInfo(undefined, result.csrfToken);
            console.log('[Extension] detectPort: updated existing QuotaService ports');
          }

          // 清除之前的错误状态
          statusBarService?.clearError();

          quotaService.stopPolling();
          quotaService.setApiMethod(getApiMethodFromConfig(config.apiMethod));
          quotaService.startPolling(config.pollingInterval);

          vscode.window.showInformationMessage(localizationService.t('notify.detectionSuccess', { port: result.port }));
        } else {
          console.warn('[Extension] detectPort command did not return valid ports');
          vscode.window.showErrorMessage(
            localizationService.t('notify.unableToDetectPort') + '\n' +
            localizationService.t('notify.unableToDetectPortHint1') + '\n' +
            localizationService.t('notify.unableToDetectPortHint2')
          );
        }
      } catch (error: any) {
        const errorMsg = error?.message || String(error);
        console.error('Port detection failed:', errorMsg);
        if (error?.stack) {
          console.error('Stack:', error.stack);
        }
        vscode.window.showErrorMessage(localizationService.t('notify.portDetectionFailed', { error: errorMsg }));
      }
    }
  );

  // Listen to config changes
  const configChangeDisposable = configService.onConfigChange((newConfig) => {
    handleConfigChange(newConfig as Config);
  });

  // 窗口焦点刷新：用户从浏览器切回 VS Code 时自动刷新配额
  // 典型场景：用户在浏览器中切换账号（普通号 -> Pro），切回时需要立即看到新配额
  const windowFocusDisposable = vscode.window.onDidChangeWindowState((e) => {
    // 仅在窗口获得焦点时触发
    if (!e.focused) {
      return;
    }

    // 检查插件是否启用
    const currentConfig = configService?.getConfig();
    if (!currentConfig?.enabled) {
      return;
    }

    // 检查 quotaService 是否已初始化
    if (!quotaService) {
      console.log('[FocusRefresh] quotaService not initialized, skipping');
      return;
    }

    // 节流：X秒内只触发一次，避免频繁刷新
    const now = Date.now();
    if (now - lastFocusRefreshTime < FOCUS_REFRESH_THROTTLE_MS) {
      console.log('[FocusRefresh] Throttled, skipping refresh');
      return;
    }
    lastFocusRefreshTime = now;

    console.log('[FocusRefresh] Window focused, triggering quota refresh');
    quotaService.quickRefresh();
  });

  // Command: Google Login
  const googleLoginCommand = vscode.commands.registerCommand(
    'antigravity-quota-watcher.googleLogin',
    async () => {
      console.log('[Extension] googleLogin command invoked');
      if (!googleAuthService) {
        vscode.window.showErrorMessage(localizationService.t('login.error.serviceNotInitialized'));
        return;
      }

      statusBarService?.showLoggingIn();
      const success = await googleAuthService.login();
      if (success) {
        // 如果当前配置为 GOOGLE_API，刷新配额
        config = configService!.getConfig();
        if (config.apiMethod === 'GOOGLE_API' && quotaService) {
          quotaService.quickRefresh();
        }
      } else {
        // 登录失败，显示未登录状态
        statusBarService?.showNotLoggedIn();
      }
    }
  );

  // Command: Google Logout
  const googleLogoutCommand = vscode.commands.registerCommand(
    'antigravity-quota-watcher.googleLogout',
    async () => {
      console.log('[Extension] googleLogout command invoked');
      if (!googleAuthService) {
        return;
      }

      await googleAuthService.logout();
      // 如果当前配置为 GOOGLE_API，显示未登录状态
      config = configService!.getConfig();
      if (config.apiMethod === 'GOOGLE_API') {
        statusBarService?.showNotLoggedIn();
      }
    }
  );

  // 监听认证状态变化
  const authStateDisposable = googleAuthService.onAuthStateChange((stateInfo: AuthStateInfo) => {
    console.log('[Extension] Auth state changed:', stateInfo.state);
    const currentConfig = configService?.getConfig();
    if (currentConfig?.apiMethod !== 'GOOGLE_API') {
      return; // 不是 GOOGLE_API 模式，不处理
    }

    switch (stateInfo.state) {
      case AuthState.AUTHENTICATED:
        // 登录成功，刷新配额
        quotaService?.quickRefresh();
        break;
      case AuthState.NOT_AUTHENTICATED:
        statusBarService?.showNotLoggedIn();
        break;
      case AuthState.TOKEN_EXPIRED:
        statusBarService?.showLoginExpired();
        break;
      case AuthState.AUTHENTICATING:
        statusBarService?.showLoggingIn();
        break;
      case AuthState.ERROR:
        statusBarService?.showError(localizationService.t('login.error.authFailed'));
        break;
    }
  });

  // Add to context subscriptions
  context.subscriptions.push(
    showQuotaCommand,
    quickRefreshQuotaCommand,
    refreshQuotaCommand,
    detectPortCommand,
    googleLoginCommand,
    googleLogoutCommand,
    configChangeDisposable,
    windowFocusDisposable,
    authStateDisposable,
    { dispose: () => quotaService?.dispose() },
    { dispose: () => statusBarService?.dispose() }
  );

  // 注册开发工具命令
  registerDevCommands(context);

  // Startup log
  console.log('Antigravity Quota Watcher initialized');
}

/**
 * Initialize for GOOGLE_API method
 * Only requires Google Auth, no port detection needed
 */
async function initializeGoogleApiMethod(
  context: vscode.ExtensionContext,
  config: Config,
  localizationService: LocalizationService
): Promise<void> {
  console.log('[Extension] Initializing GOOGLE_API method (no port detection needed)');

  // 显示初始化状态
  statusBarService!.showInitializing();

  // Init quota service for Google API (no port/csrf needed)
  quotaService = new QuotaService(0, undefined, undefined);
  quotaService.setApiMethod(QuotaApiMethod.GOOGLE_API);

  // Register callbacks
  registerQuotaServiceCallbacks();

  // Check auth state and start polling
  const authState = googleAuthService!.getAuthState();
  if (authState.state === AuthState.NOT_AUTHENTICATED) {
    statusBarService!.showNotLoggedIn();
    statusBarService!.show();
  } else if (authState.state === AuthState.TOKEN_EXPIRED) {
    statusBarService!.showLoginExpired();
    statusBarService!.show();
  } else if (config.enabled) {
    console.log('[Extension] GOOGLE_API: Starting quota polling...');
    statusBarService!.showFetching();
    quotaService.startPolling(config.pollingInterval);
    statusBarService!.show();
  }
}

/**
 * Initialize for local API methods (GET_USER_STATUS / COMMAND_MODEL_CONFIG)
 * Requires port detection and CSRF token
 */
async function initializeLocalApiMethod(
  context: vscode.ExtensionContext,
  config: Config,
  localizationService: LocalizationService
): Promise<void> {
  console.log('[Extension] Initializing local API method (port detection required)');

  // Initialize port detection service
  portDetectionService = new PortDetectionService(context);

  // 显示检测状态
  statusBarService!.showDetecting();

  // Auto detect port and csrf token
  let detectedPort: number | null = null;
  let detectedCsrfToken: string | null = null;
  let detectionResult: PortDetectionResult | null = null;

  try {
    console.log('[Extension] Starting initial port detection');
    const result = await portDetectionService.detectPort();
    if (result) {
      detectionResult = result;
      detectedPort = result.port;
      detectedCsrfToken = result.csrfToken;
      console.log('[Extension] Initial port detection success:', detectionResult);
    }
  } catch (error) {
    console.error('❌ Port/CSRF detection failed', error);
    if (error instanceof Error && error.stack) {
      console.error('Stack:', error.stack);
    }
  }

  // Ensure port and CSRF token are available
  if (!detectedPort || !detectedCsrfToken) {
    console.error('Missing port or CSRF Token, extension cannot start');
    console.error('Please ensure Antigravity language server is running');
    statusBarService!.showError('Port/CSRF Detection failed, Please try restart.');
    statusBarService!.show();

    // 显示用户提示,提供重试选项
    vscode.window.showWarningMessage(
      localizationService.t('notify.unableToDetectProcess'),
      localizationService.t('notify.retry'),
      localizationService.t('notify.cancel')
    ).then(action => {
      if (action === localizationService.t('notify.retry')) {
        vscode.commands.executeCommand('antigravity-quota-watcher.detectPort');
      }
    });
  } else {
    // 显示初始化状态
    statusBarService!.showInitializing();

    // Init quota service
    quotaService = new QuotaService(detectedPort, undefined, detectionResult?.httpPort);
    quotaService.setPorts(detectionResult?.connectPort ?? detectedPort, detectionResult?.httpPort);
    quotaService.setApiMethod(getApiMethodFromConfig(config.apiMethod));

    // Register callbacks
    registerQuotaServiceCallbacks();

    // If enabled, start polling after a short delay
    if (config.enabled) {
      console.log('Starting quota polling after delay...');
      statusBarService!.showFetching();

      setTimeout(() => {
        quotaService?.setAuthInfo(undefined, detectedCsrfToken);
        quotaService?.startPolling(config.pollingInterval);
      }, 8000);

      statusBarService!.show();
    }
  }
}

/**
 * Register common callbacks for quota service
 */
function registerQuotaServiceCallbacks(): void {
  if (!quotaService || !statusBarService) {
    return;
  }

  // Register quota update callback
  quotaService.onQuotaUpdate((snapshot: QuotaSnapshot) => {
    statusBarService?.updateDisplay(snapshot);
  });

  // Register error callback (silent, only update status bar)
  quotaService.onError((error: Error) => {
    console.error('Quota fetch failed:', error);
    statusBarService?.showError(`Connection failed: ${error.message}`);
  });

  // Register status callback
  quotaService.onStatus((status: 'fetching' | 'retrying', retryCount?: number) => {
    if (status === 'fetching') {
      statusBarService?.showFetching();
    } else if (status === 'retrying' && retryCount !== undefined) {
      statusBarService?.showRetrying(retryCount, 3); // MAX_RETRY_COUNT = 3
    }
  });

  // Register auth status callback (for GOOGLE_API method)
  quotaService.onAuthStatus((needsLogin: boolean, isExpired: boolean) => {
    if (needsLogin) {
      if (isExpired) {
        statusBarService?.showLoginExpired();
      } else {
        statusBarService?.showNotLoggedIn();
      }
    }
  });

  // Register stale status callback (for GOOGLE_API method - network issues)
  quotaService.onStaleStatus((isStale: boolean) => {
    if (isStale) {
      statusBarService?.showStale();
    } else {
      statusBarService?.clearStale();
    }
  });
}

/**
 * Handle config changes with debounce to prevent race conditions
 */
function handleConfigChange(config: Config): void {
  // 防抖：300ms 内的多次变更只执行最后一次
  if (configChangeTimer) {
    clearTimeout(configChangeTimer);
  }

  configChangeTimer = setTimeout(async () => {
    console.log('Config updated (debounced)', config);

    const newApiMethod = getApiMethodFromConfig(config.apiMethod);

    // Update status bar settings
    statusBarService?.setWarningThreshold(config.warningThreshold);
    statusBarService?.setCriticalThreshold(config.criticalThreshold);
    statusBarService?.setShowPromptCredits(config.showPromptCredits);
    statusBarService?.setShowPlanName(config.showPlanName);
    statusBarService?.setShowGeminiPro(config.showGeminiPro);
    statusBarService?.setShowGeminiFlash(config.showGeminiFlash);
    statusBarService?.setDisplayStyle(config.displayStyle);

    // Update language
    const localizationService = LocalizationService.getInstance();
    if (localizationService.getLanguage() !== config.language) {
      localizationService.setLanguage(config.language);
    }

    // Handle API method change
    if (quotaService) {
      const currentApiMethod = quotaService.getApiMethod();
      quotaService.setApiMethod(newApiMethod);

      // 如果切换到 GOOGLE_API，检查认证状态
      if (newApiMethod === QuotaApiMethod.GOOGLE_API && googleAuthService) {
        const authState = googleAuthService.getAuthState();
        if (authState.state === AuthState.NOT_AUTHENTICATED) {
          quotaService.stopPolling();
          statusBarService?.showNotLoggedIn();
          statusBarService?.show();
          vscode.window.showInformationMessage(localizationService.t('notify.configUpdated'));
          return;
        } else if (authState.state === AuthState.TOKEN_EXPIRED) {
          quotaService.stopPolling();
          statusBarService?.showLoginExpired();
          statusBarService?.show();
          vscode.window.showInformationMessage(localizationService.t('notify.configUpdated'));
          return;
        }
      }

      // 如果从 GOOGLE_API 切换到本地 API 方法，需要检测端口和获取 CSRF token
      if (currentApiMethod === QuotaApiMethod.GOOGLE_API && newApiMethod !== QuotaApiMethod.GOOGLE_API) {
        console.log('[ConfigChange] Switching from GOOGLE_API to local API, need port detection');
        quotaService.stopPolling();
        statusBarService?.showDetecting();

        // 异步执行端口检测
        (async () => {
          try {
            // 确保 portDetectionService 已初始化
            if (!portDetectionService) {
              // 需要 context，但这里拿不到，所以触发命令
              await vscode.commands.executeCommand('antigravity-quota-watcher.detectPort');
              return;
            }

            const result = await portDetectionService.detectPort();
            if (result && result.port && result.csrfToken) {
              console.log('[ConfigChange] Port detection success:', result);
              quotaService!.setPorts(result.connectPort, result.httpPort);
              quotaService!.setAuthInfo(undefined, result.csrfToken);
              statusBarService?.clearError();

              if (config.enabled) {
                quotaService!.startPolling(config.pollingInterval);
              }
              vscode.window.showInformationMessage(localizationService.t('notify.configUpdated'));
            } else {
              console.warn('[ConfigChange] Port detection failed, no valid result');
              statusBarService?.showError('Port/CSRF Detection failed');
              vscode.window.showWarningMessage(
                localizationService.t('notify.unableToDetectPort'),
                localizationService.t('notify.retry')
              ).then(action => {
                if (action === localizationService.t('notify.retry')) {
                  vscode.commands.executeCommand('antigravity-quota-watcher.detectPort');
                }
              });
            }
          } catch (error: any) {
            console.error('[ConfigChange] Port detection error:', error);
            statusBarService?.showError(`Detection failed: ${error.message}`);
          }
        })();
        return; // 异步处理，提前返回
      }
    }

    if (config.enabled) {
      quotaService?.startPolling(config.pollingInterval);
      statusBarService?.show();
    } else {
      quotaService?.stopPolling();
      statusBarService?.hide();
    }

    vscode.window.showInformationMessage(localizationService.t('notify.configUpdated'));
  }, 300);
}

/**
 * Called when the extension is deactivated
 */
export function deactivate() {
  console.log('Antigravity Quota Watcher deactivated');
  quotaService?.dispose();
  statusBarService?.dispose();
}

/**
 * Convert config apiMethod string to QuotaApiMethod enum
 */
function getApiMethodFromConfig(apiMethod: string): QuotaApiMethod {
  switch (apiMethod) {
    //     case 'COMMAND_MODEL_CONFIG':
    //       return QuotaApiMethod.COMMAND_MODEL_CONFIG;
    case 'GOOGLE_API':
      return QuotaApiMethod.GOOGLE_API;
    case 'GET_USER_STATUS':
    default:
      return QuotaApiMethod.GET_USER_STATUS;
  }
}
