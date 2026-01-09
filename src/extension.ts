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
import { GoogleAuthService, AuthState, AuthStateInfo, extractRefreshTokenFromAntigravity, hasAntigravityDb, TokenSyncChecker } from './auth';

const NON_AG_PROMPT_KEY = 'nonAgSwitchPromptDismissed';

let quotaService: QuotaService | undefined;
let statusBarService: StatusBarService | undefined;
let configService: ConfigService | undefined;
let portDetectionService: PortDetectionService | undefined;
let googleAuthService: GoogleAuthService | undefined;
let configChangeTimer: NodeJS.Timeout | undefined;  // 配置变更防抖定时器
let localTokenCheckTimer: NodeJS.Timeout | undefined;  // 未登录状态下检查本地 token 的定时器
let lastFocusRefreshTime: number = 0;  // 上次焦点刷新时间戳
let globalState: vscode.Memento | undefined;
const FOCUS_REFRESH_THROTTLE_MS = 3000;  // 焦点刷新节流阈值
const AUTO_REDETECT_THROTTLE_MS = 30000; // 自动重探端口节流
const LOCAL_TOKEN_CHECK_INTERVAL_MS = 30000; // 未登录状态下检查本地 token 的间隔
let lastAutoRedetectTime: number = 0;

/**
 * Called when the extension is activated
 */
export async function activate(context: vscode.ExtensionContext) {
  // Initialize and print version info
  versionInfo.initialize(context);
  console.log(`=== Antigravity Quota Watcher v${versionInfo.getExtensionVersion()} ===`);
  console.log(`Running on: ${versionInfo.getIdeName()} v${versionInfo.getIdeVersion()}`);
  globalState = context.globalState;

  // Init services
  configService = new ConfigService();
  let config = configService.getConfig();

  // Initialize localization
  const localizationService = LocalizationService.getInstance();
  localizationService.setLanguage(config.language);

  const isAntigravityIde = versionInfo.isAntigravityIde();

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

  // 非 Antigravity 环境且用户选择了本地 API 时，给出切换提示
  const suppressNonAgPrompt = globalState?.get<boolean>(NON_AG_PROMPT_KEY, false);
  if (!isAntigravityIde && apiMethod === QuotaApiMethod.GET_USER_STATUS && !suppressNonAgPrompt) {
    const switchLabel = localizationService.t('notify.switchToGoogleApi');
    const keepLabel = localizationService.t('notify.keepLocalApi');
    const neverLabel = localizationService.t('notify.neverShowAgain');
    const selection = await vscode.window.showInformationMessage(
      localizationService.t('notify.nonAntigravityDetected'),
      switchLabel,
      keepLabel,
      neverLabel
    );

    if (selection === switchLabel) {
      await vscode.workspace.getConfiguration('antigravityQuotaWatcher').update('apiMethod', 'GOOGLE_API', true);
      config = configService.getConfig();
    } else if (selection === neverLabel) {
      await globalState?.update(NON_AG_PROMPT_KEY, true);
    }
  }

  const resolvedApiMethod = getApiMethodFromConfig(config.apiMethod);

  if (resolvedApiMethod === QuotaApiMethod.GOOGLE_API) {
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
        // quotaService 未初始化，根据 API 模式给出不同提示
        config = configService!.getConfig();
        const currentApiMethod = getApiMethodFromConfig(config.apiMethod);
        
        if (currentApiMethod === QuotaApiMethod.GOOGLE_API) {
          // GOOGLE_API 模式下，提示用户需要先登录
          console.log('[Extension] quotaService not initialized in GOOGLE_API mode, prompt login');
          vscode.window.showInformationMessage(
            localizationService.t('notify.pleaseLoginFirst') || '请先登录 Google 账号'
          );
        } else {
          // 本地 API 模式，委托给 detectPort 命令进行重新检测
          console.log('[Extension] quotaService not initialized, delegating to detectPort command');
          await vscode.commands.executeCommand('antigravity-quota-watcher.detectPort');
        }
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
        // quotaService 未初始化，根据 API 模式给出不同提示
        config = configService!.getConfig();
        const currentApiMethod = getApiMethodFromConfig(config.apiMethod);
        
        if (currentApiMethod === QuotaApiMethod.GOOGLE_API) {
          // GOOGLE_API 模式下，提示用户需要先登录
          console.log('[Extension] quotaService not initialized in GOOGLE_API mode, prompt login');
          vscode.window.showInformationMessage(
            localizationService.t('notify.pleaseLoginFirst') || '请先登录 Google 账号'
          );
        } else {
          // 本地 API 模式，委托给 detectPort 命令进行重新检测
          console.log('[Extension] quotaService not initialized, delegating to detectPort command');
          await vscode.commands.executeCommand('antigravity-quota-watcher.detectPort');
        }
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
    // GOOGLE_API 模式无需焦点刷新，避免多余请求
    if (getApiMethodFromConfig(currentConfig.apiMethod) === QuotaApiMethod.GOOGLE_API) {
      console.log('[FocusRefresh] GOOGLE_API mode, skip focus-triggered refresh');
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
          if (config.enabled) {
            await quotaService.startPolling(config.pollingInterval);
          }
          await quotaService.quickRefresh();
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

      const wasLoggedIn = await googleAuthService.logout();
      if (wasLoggedIn) {
        vscode.window.showInformationMessage('已登出 Google 账号');
      }
      // 如果当前配置为 GOOGLE_API，立即停止轮询并更新状态栏
      config = configService!.getConfig();
      if (config.apiMethod === 'GOOGLE_API') {
        quotaService?.stopPolling();
        statusBarService?.clearStale();
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
        // 登录成功，停止本地 token 检查，刷新配额并恢复轮询
        stopLocalTokenCheckTimer();
        if (currentConfig?.enabled) {
          quotaService?.startPolling(currentConfig.pollingInterval);
          quotaService?.quickRefresh();
        }
        break;
      case AuthState.NOT_AUTHENTICATED:
        quotaService?.stopPolling();
        statusBarService?.clearStale();
        statusBarService?.showNotLoggedIn();
        // 启动本地 token 检查定时器
        startLocalTokenCheckTimer();
        break;
      case AuthState.TOKEN_EXPIRED:
        quotaService?.stopPolling();
        statusBarService?.clearStale();
        statusBarService?.showLoginExpired();
        // 启动本地 token 检查定时器
        startLocalTokenCheckTimer();
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
    // 检查本地 Antigravity 是否有已存储的 token
    if (hasAntigravityDb()) {
      console.log('[Extension] Detected local Antigravity installation, checking for stored token...');
      const refreshToken = await extractRefreshTokenFromAntigravity();
      
      if (refreshToken) {
        console.log('[Extension] Found local Antigravity token, prompting user...');
        
        // 先设置为未登录状态并启动定时器，避免弹窗自动消失时状态栏卡住
        // 因为 VS Code 的 showInformationMessage 在弹窗自动消失时 Promise 可能不会立即 resolve
        statusBarService!.showNotLoggedIn();
        statusBarService!.show();
        startLocalTokenCheckTimer();
        console.log('[Extension] Pre-set status to not logged in before showing prompt');
        
        const useLocalToken = localizationService.t('notify.useLocalToken') || '使用本地 Token 登录';
        const manualLogin = localizationService.t('notify.manualLogin') || '手动登录';
        
        // 使用非阻塞方式处理弹窗，不等待用户响应
        vscode.window.showInformationMessage(
          localizationService.t('notify.localTokenDetected') || '检测到本地 Antigravity 已登录，是否使用该账号？',
          useLocalToken,
          manualLogin
        ).then(async (selection) => {
          if (selection === useLocalToken) {
            console.log('[Extension] User selected to use local token');
            stopLocalTokenCheckTimer();
            statusBarService!.showLoggingIn();
            const success = await googleAuthService!.loginWithRefreshToken(refreshToken);
            if (success) {
              // 登录成功，开始轮询
              if (config.enabled) {
                console.log('[Extension] GOOGLE_API: Starting quota polling after local token login...');
                statusBarService!.showFetching();
                quotaService!.startPolling(config.pollingInterval);
              }
              statusBarService!.show();
            } else {
              // 登录失败，恢复未登录状态
              console.log('[Extension] Local token login failed, reverting to not logged in');
              statusBarService!.showNotLoggedIn();
              statusBarService!.show();
              startLocalTokenCheckTimer();
            }
          } else if (selection === manualLogin) {
            console.log('[Extension] User selected manual login');
            // 状态已经是未登录，定时器已启动，无需额外操作
          } else {
            console.log('[Extension] User dismissed the prompt (selection: undefined)');
            // 弹窗被关闭或自动消失，状态已经是未登录，定时器已启动，无需额外操作
          }
        });
        
        // 不等待弹窗响应，直接返回
        return;
      }
    }
    
    // 无论是没有本地 token，还是用户关闭弹窗，都显示未登录状态
    statusBarService!.showNotLoggedIn();
    statusBarService!.show();
    // 启动本地 token 检查定时器，以便后续检测到本地登录
    startLocalTokenCheckTimer();
  } else if (authState.state === AuthState.TOKEN_EXPIRED) {
    statusBarService!.showLoginExpired();
    statusBarService!.show();
    // Token 过期时也启动本地 token 检查定时器
    startLocalTokenCheckTimer();
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
 * 启动本地 token 检查定时器（未登录状态下使用）
 * 定期检查本地 Antigravity 是否有可用的 token
 */
function startLocalTokenCheckTimer(): void {
  // 如果已经在运行，不重复启动
  if (localTokenCheckTimer) {
    console.log('[LocalTokenCheck] Timer already running');
    return;
  }

  // 只在 GOOGLE_API 模式下启动
  const config = configService?.getConfig();
  if (config?.apiMethod !== 'GOOGLE_API') {
    return;
  }

  console.log('[LocalTokenCheck] Starting local token check timer');
  const tokenSyncChecker = TokenSyncChecker.getInstance();

  localTokenCheckTimer = setInterval(async () => {
    console.log('[LocalTokenCheck] Checking for local token...');
    await tokenSyncChecker.checkLocalTokenWhenNotLoggedIn(
      // onLocalTokenLogin: 本地 token 登录成功
      () => {
        console.log('[LocalTokenCheck] Local token login successful');
        stopLocalTokenCheckTimer();
        const currentConfig = configService?.getConfig();
        if (currentConfig?.enabled && quotaService) {
          statusBarService?.showFetching();
          quotaService.startPolling(currentConfig.pollingInterval);
        }
      }
    );
  }, LOCAL_TOKEN_CHECK_INTERVAL_MS);
}

/**
 * 停止本地 token 检查定时器
 */
function stopLocalTokenCheckTimer(): void {
  if (localTokenCheckTimer) {
    console.log('[LocalTokenCheck] Stopping local token check timer');
    clearInterval(localTokenCheckTimer);
    localTokenCheckTimer = undefined;
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

    // 对于 GOOGLE_API 方法，检查 Token 同步状态
    const apiMethod = quotaService?.getApiMethod();
    if (apiMethod === QuotaApiMethod.GOOGLE_API) {
      const tokenSyncChecker = TokenSyncChecker.getInstance();
      tokenSyncChecker.checkAndHandle(
        // onTokenChanged: 刷新配额
        () => {
          quotaService?.quickRefresh();
        },
        // onLogout: 停止轮询，显示未登录，启动本地 token 检查
        () => {
          quotaService?.stopPolling();
          statusBarService?.clearStale();
          statusBarService?.showNotLoggedIn();
          startLocalTokenCheckTimer();
        },
        // onLocalTokenLogin: 本地 token 登录成功，停止检查定时器，开始轮询
        () => {
          stopLocalTokenCheckTimer();
          const config = configService?.getConfig();
          if (config?.enabled) {
            quotaService?.startPolling(config.pollingInterval);
          }
        }
      );
    }
  });

  // Register error callback (silent, only update status bar)
  quotaService.onError((error: Error) => {
    console.error('Quota fetch failed:', error);
    statusBarService?.showError(`Connection failed: ${error.message}`);

    // 自动重探：本地 API 且疑似端口/CSRF 失效时，节流触发 detectPort
    const apiMethod = quotaService?.getApiMethod();
    if (shouldAutoRedetectPort(error, apiMethod)) {
      const now = Date.now();
      if (now - lastAutoRedetectTime >= AUTO_REDETECT_THROTTLE_MS) {
        lastAutoRedetectTime = now;
        vscode.commands.executeCommand('antigravity-quota-watcher.detectPort');
      } else {
        console.log('[AutoRedetect] Throttled; skip detectPort this time');
      }
    }
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
      // 未登录或 token 过期时，启动本地 token 检查定时器
      startLocalTokenCheckTimer();
    } else {
      // 已登录，停止本地 token 检查定时器
      stopLocalTokenCheckTimer();
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
    const localizationService = LocalizationService.getInstance();
    const isAntigravityIde = versionInfo.isAntigravityIde();
    const suppressNonAgPrompt = globalState?.get<boolean>(NON_AG_PROMPT_KEY, false);

    // Update status bar settings
    statusBarService?.setWarningThreshold(config.warningThreshold);
    statusBarService?.setCriticalThreshold(config.criticalThreshold);
    statusBarService?.setShowPromptCredits(config.showPromptCredits);
    statusBarService?.setShowPlanName(config.showPlanName);
    statusBarService?.setShowGeminiPro(config.showGeminiPro);
    statusBarService?.setShowGeminiFlash(config.showGeminiFlash);
    statusBarService?.setDisplayStyle(config.displayStyle);

    // Update language
    if (localizationService.getLanguage() !== config.language) {
      localizationService.setLanguage(config.language);
    }

    // 非 Antigravity 环境切换到本地 API 时提示用户
    const currentApiMethod = quotaService?.getApiMethod();
    if (
      !isAntigravityIde &&
      newApiMethod === QuotaApiMethod.GET_USER_STATUS &&
      currentApiMethod !== QuotaApiMethod.GET_USER_STATUS &&
      !suppressNonAgPrompt
    ) {
      const switchLabel = localizationService.t('notify.switchToGoogleApi');
      const keepLabel = localizationService.t('notify.keepLocalApi');
      const neverLabel = localizationService.t('notify.neverShowAgain');
      const selection = await vscode.window.showInformationMessage(
        localizationService.t('notify.nonAntigravityDetected'),
        switchLabel,
        keepLabel,
        neverLabel
      );

      if (selection === switchLabel) {
        await vscode.workspace.getConfiguration('antigravityQuotaWatcher').update('apiMethod', 'GOOGLE_API', true);
        return;
      } else if (selection === neverLabel) {
        await globalState?.update(NON_AG_PROMPT_KEY, true);
      }
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
          
          // 检查本地 Antigravity 是否有已存储的 token
          if (hasAntigravityDb()) {
            console.log('[ConfigChange] Detected local Antigravity installation, checking for stored token...');
            const refreshToken = await extractRefreshTokenFromAntigravity();
            
            if (refreshToken) {
              console.log('[ConfigChange] Found local Antigravity token, prompting user...');
              const useLocalToken = localizationService.t('notify.useLocalToken') || '使用本地 Token 登录';
              const manualLogin = localizationService.t('notify.manualLogin') || '手动登录';
              
              const selection = await vscode.window.showInformationMessage(
                localizationService.t('notify.localTokenDetected') || '检测到本地 Antigravity 已登录，是否使用该账号？',
                useLocalToken,
                manualLogin
              );
              
              if (selection === useLocalToken) {
                statusBarService?.showLoggingIn();
                const success = await googleAuthService.loginWithRefreshToken(refreshToken);
                if (success) {
                  // 登录成功，开始轮询
                  if (config.enabled) {
                    quotaService.startPolling(config.pollingInterval);
                  }
                  statusBarService?.show();
                  vscode.window.showInformationMessage(localizationService.t('notify.configUpdated'));
                  return;
                }
                // 登录失败，继续显示未登录状态
              }
              // 用户选择手动登录或关闭弹窗，显示未登录状态
            }
          }
          
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
  stopLocalTokenCheckTimer();
  quotaService?.dispose();
  statusBarService?.dispose();
}

/**
 * 判断是否需要自动重探端口/CSRF
 * 仅在本地 API 模式下对端口/CSRF/连接错误触发
 */
function shouldAutoRedetectPort(error: Error, apiMethod: QuotaApiMethod | undefined): boolean {
  if (!apiMethod || apiMethod === QuotaApiMethod.GOOGLE_API) {
    return false;
  }

  const msg = (error?.message || '').toLowerCase();
  if (!msg) {
    return false;
  }

  return (
    error.name === 'QuotaInvalidCodeError' ||
    msg.includes('missing csrf') ||
    msg.includes('csrf token') ||
    msg.includes('connection refused') ||
    msg.includes('econnrefused') ||
    msg.includes('socket') ||
    msg.includes('port') ||
    (msg.includes('http error') && msg.includes('403')) ||
    msg.includes('invalid response code')
  );
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
