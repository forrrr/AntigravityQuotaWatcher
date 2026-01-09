/**
 * Token 同步检查服务
 * 检查本地 Antigravity 的 token 是否与插件存储的一致
 * 仅对 source === 'imported' 的 token 进行检查
 * 
 * 同时支持在未登录状态下检测本地 token 是否出现（用户在 IDE 登录后）
 */

import * as vscode from 'vscode';
import { GoogleAuthService } from './googleAuthService';
import { extractRefreshTokenFromAntigravity, hasAntigravityDb } from './antigravityTokenExtractor';
import { TokenStorage } from './tokenStorage';
import { LocalizationService } from '../i18n/localizationService';

/**
 * 同步检查结果
 */
export enum TokenSyncStatus {
    /** 不需要检查（source 不是 imported） */
    SKIP = 'skip',
    /** Token 一致，无需操作 */
    IN_SYNC = 'in_sync',
    /** 本地 Token 已变更（切换账号） */
    TOKEN_CHANGED = 'token_changed',
    /** 本地 Token 已清除（退出登录） */
    TOKEN_REMOVED = 'token_removed',
    /** 检测到本地有新 Token（未登录状态下） */
    LOCAL_TOKEN_AVAILABLE = 'local_token_available',
    /** 检查出错 */
    ERROR = 'error',
}

/**
 * Token 同步检查器
 */
export class TokenSyncChecker {
    private static instance: TokenSyncChecker;
    private lastCheckTime: number = 0;
    private lastPromptTime: number = 0;
    private lastNotLoggedInCheckTime: number = 0;
    private isPromptShowing: boolean = false;
    
    // 检查间隔：30 秒
    private readonly CHECK_INTERVAL_MS = 30 * 1000;
    // 未登录状态下检查本地 token 的间隔：30 秒
    private readonly NOT_LOGGED_IN_CHECK_INTERVAL_MS = 20 * 1000;
    // 弹窗冷却：用户关闭弹窗后 5 分钟内不再提示
    private readonly PROMPT_COOLDOWN_MS = 5 * 60 * 1000;

    private constructor() {}

    public static getInstance(): TokenSyncChecker {
        if (!TokenSyncChecker.instance) {
            TokenSyncChecker.instance = new TokenSyncChecker();
        }
        return TokenSyncChecker.instance;
    }

    /**
     * 检查 Token 同步状态
     * @returns 同步状态
     */
    public async checkSync(): Promise<TokenSyncStatus> {
        const tokenStorage = TokenStorage.getInstance();
        
        // 检查是否已登录
        const hasToken = await tokenStorage.hasToken();
        
        if (!hasToken) {
            // 未登录状态：检查本地是否有可用的 token
            if (hasAntigravityDb()) {
                try {
                    const localToken = await extractRefreshTokenFromAntigravity();
                    if (localToken) {
                        console.log('[TokenSyncChecker] Not logged in but local token available');
                        return TokenSyncStatus.LOCAL_TOKEN_AVAILABLE;
                    }
                } catch (e) {
                    console.log('[TokenSyncChecker] Error checking local token:', e);
                }
            }
            return TokenSyncStatus.SKIP;
        }
        
        // 检查 token 来源
        const source = await tokenStorage.getTokenSource();
        if (source !== 'imported') {
            return TokenSyncStatus.SKIP;
        }

        // 检查本地 Antigravity 数据库是否存在
        if (!hasAntigravityDb()) {
            // 数据库不存在，可能是 Antigravity 被卸载了
            console.log('[TokenSyncChecker] Antigravity database not found');
            return TokenSyncStatus.TOKEN_REMOVED;
        }

        try {
            // 获取当前存储的 refresh_token
            const currentRefreshToken = await tokenStorage.getRefreshToken();
            if (!currentRefreshToken) {
                return TokenSyncStatus.ERROR;
            }

            // 获取本地 Antigravity 的 refresh_token
            const localRefreshToken = await extractRefreshTokenFromAntigravity();

            if (!localRefreshToken) {
                // 本地没有 token 了（用户在 Antigravity 退出登录）
                console.log('[TokenSyncChecker] Local Antigravity token removed');
                return TokenSyncStatus.TOKEN_REMOVED;
            }

            if (localRefreshToken !== currentRefreshToken) {
                // Token 不一致（用户在 Antigravity 切换了账号）
                console.log('[TokenSyncChecker] Local Antigravity token changed');
                return TokenSyncStatus.TOKEN_CHANGED;
            }

            return TokenSyncStatus.IN_SYNC;
        } catch (e) {
            console.error('[TokenSyncChecker] Check failed:', e);
            return TokenSyncStatus.ERROR;
        }
    }

    /**
     * 执行同步检查并处理结果（带节流）
     * @param onTokenChanged 当 token 变更时的回调（用于刷新配额）
     * @param onLogout 当需要退出登录时的回调
     * @param onLocalTokenLogin 当未登录状态下检测到本地 token 并成功登录时的回调
     * @returns 是否执行了检查
     */
    public async checkAndHandle(
        onTokenChanged?: () => void,
        onLogout?: () => void,
        onLocalTokenLogin?: () => void
    ): Promise<boolean> {
        const now = Date.now();

        // 如果弹窗正在显示，跳过
        if (this.isPromptShowing) {
            return false;
        }

        const status = await this.checkSync();

        // 对于未登录状态下检测本地 token，使用单独的节流
        if (status === TokenSyncStatus.LOCAL_TOKEN_AVAILABLE) {
            if (now - this.lastNotLoggedInCheckTime < this.NOT_LOGGED_IN_CHECK_INTERVAL_MS) {
                return false;
            }
            this.lastNotLoggedInCheckTime = now;
            
            // 弹窗冷却检查
            if (now - this.lastPromptTime < this.PROMPT_COOLDOWN_MS) {
                console.log('[TokenSyncChecker] Prompt cooldown for local token, skipping');
                return true;
            }
            
            await this.showLocalTokenPrompt(onLocalTokenLogin);
            return true;
        }

        // 节流：检查间隔（针对已登录状态的同步检查）
        if (now - this.lastCheckTime < this.CHECK_INTERVAL_MS) {
            return false;
        }
        this.lastCheckTime = now;

        if (status === TokenSyncStatus.SKIP || status === TokenSyncStatus.IN_SYNC) {
            return true;
        }

        if (status === TokenSyncStatus.ERROR) {
            console.warn('[TokenSyncChecker] Check returned error, skipping prompt');
            return true;
        }

        // 弹窗冷却检查
        if (now - this.lastPromptTime < this.PROMPT_COOLDOWN_MS) {
            console.log('[TokenSyncChecker] Prompt cooldown, skipping');
            return true;
        }

        // 显示弹窗
        await this.showSyncPrompt(status, onTokenChanged, onLogout);
        return true;
    }

    /**
     * 在未登录状态下检查本地 token 并处理（带节流）
     * 这个方法专门用于未登录状态下的轮询检查
     * @param onLocalTokenLogin 当成功登录时的回调
     * @returns 是否执行了检查
     */
    public async checkLocalTokenWhenNotLoggedIn(
        onLocalTokenLogin?: () => void
    ): Promise<boolean> {
        const now = Date.now();

        // 如果弹窗正在显示，跳过
        if (this.isPromptShowing) {
            return false;
        }

        // 节流
        if (now - this.lastNotLoggedInCheckTime < this.NOT_LOGGED_IN_CHECK_INTERVAL_MS) {
            return false;
        }
        this.lastNotLoggedInCheckTime = now;

        // 检查本地是否有可用的 token
        if (!hasAntigravityDb()) {
            return true;
        }

        try {
            const localToken = await extractRefreshTokenFromAntigravity();
            if (!localToken) {
                return true;
            }

            console.log('[TokenSyncChecker] Local token detected while not logged in');

            // 弹窗冷却检查
            if (now - this.lastPromptTime < this.PROMPT_COOLDOWN_MS) {
                console.log('[TokenSyncChecker] Prompt cooldown for local token, skipping');
                return true;
            }

            await this.showLocalTokenPrompt(onLocalTokenLogin);
            return true;
        } catch (e) {
            console.log('[TokenSyncChecker] Error checking local token:', e);
            return true;
        }
    }

    /**
     * 显示本地 token 可用的提示弹窗（未登录状态下）
     */
    private async showLocalTokenPrompt(
        onLocalTokenLogin?: () => void
    ): Promise<void> {
        this.isPromptShowing = true;
        const localizationService = LocalizationService.getInstance();
        const googleAuthService = GoogleAuthService.getInstance();

        try {
            const useLocalToken = localizationService.t('notify.useLocalToken') || '使用本地 Token 登录';
            const manualLogin = localizationService.t('notify.manualLogin') || '手动登录';

            const selection = await vscode.window.showInformationMessage(
                localizationService.t('notify.localTokenDetected') || '检测到本地 Antigravity 已登录，是否使用该账号？',
                useLocalToken,
                manualLogin
            );

            if (selection === useLocalToken) {
                const refreshToken = await extractRefreshTokenFromAntigravity();
                if (refreshToken) {
                    const success = await googleAuthService.loginWithRefreshToken(refreshToken);
                    if (success && onLocalTokenLogin) {
                        onLocalTokenLogin();
                    }
                }
            } else if (selection === manualLogin) {
                // 用户选择手动登录，触发登录命令
                vscode.commands.executeCommand('antigravity-quota-watcher.googleLogin');
            }
            // 用户关闭弹窗（selection === undefined），记录时间，稍后再提示
        } finally {
            this.isPromptShowing = false;
            this.lastPromptTime = Date.now();
        }
    }

    /**
     * 显示同步提示弹窗
     */
    private async showSyncPrompt(
        status: TokenSyncStatus,
        onTokenChanged?: () => void,
        onLogout?: () => void
    ): Promise<void> {
        this.isPromptShowing = true;
        const localizationService = LocalizationService.getInstance();
        const googleAuthService = GoogleAuthService.getInstance();

        try {
            if (status === TokenSyncStatus.TOKEN_CHANGED) {
                // Token 变更（切换账号）
                const syncLabel = localizationService.t('notify.syncToken') || '同步';
                const keepLabel = localizationService.t('notify.keepCurrentToken') || '保持当前';

                // 使用模态对话框，确保用户必须做出选择，不会自动消失
                const selection = await vscode.window.showInformationMessage(
                    localizationService.t('notify.tokenChanged') || '检测到 Antigravity 账号已变更，是否同步？',
                    { modal: true },
                    syncLabel,
                    keepLabel
                );

                if (selection === syncLabel) {
                    // 用户选择同步，使用新的 token 登录
                    const newToken = await extractRefreshTokenFromAntigravity();
                    if (newToken) {
                        const success = await googleAuthService.loginWithRefreshToken(newToken);
                        if (success && onTokenChanged) {
                            onTokenChanged();
                        }
                    }
                } else if (selection === keepLabel) {
                    // 用户选择保持当前，转换为手动登录，不再检查
                    await googleAuthService.convertToManualSource();
                }
                // 用户关闭弹窗（selection === undefined），记录时间，稍后再提示
                
            } else if (status === TokenSyncStatus.TOKEN_REMOVED) {
                // Token 被移除（退出登录）
                const syncLogoutLabel = localizationService.t('notify.syncLogout') || '同步退出';
                const keepLoginLabel = localizationService.t('notify.keepLogin') || '保持登录';

                // 使用模态对话框，确保用户必须做出选择，不会自动消失
                const selection = await vscode.window.showInformationMessage(
                    localizationService.t('notify.tokenRemoved') || '检测到 Antigravity 已退出登录，是否同步退出？',
                    { modal: true },
                    syncLogoutLabel,
                    keepLoginLabel
                );

                if (selection === syncLogoutLabel) {
                    // 用户选择同步退出
                    const wasLoggedIn = await googleAuthService.logout();
                    if (wasLoggedIn) {
                        vscode.window.showInformationMessage('已登出 Google 账号');
                    }
                    if (onLogout) {
                        onLogout();
                    }
                } else if (selection === keepLoginLabel) {
                    // 用户选择保持登录，转换为手动登录，不再检查
                    await googleAuthService.convertToManualSource();
                }
                // 用户点击 X 关闭模态框，记录时间，稍后再提示
            }
        } finally {
            this.isPromptShowing = false;
            this.lastPromptTime = Date.now();
        }
    }

    /**
     * 重置检查状态（用于测试或强制重新检查）
     */
    public reset(): void {
        this.lastCheckTime = 0;
        this.lastPromptTime = 0;
        this.lastNotLoggedInCheckTime = 0;
        this.isPromptShowing = false;
    }
}
