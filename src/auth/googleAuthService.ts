/**
 * Google OAuth 2.0 认证服务
 * 管理 Google 账号登录、Token 刷新和认证状态
 */

import * as vscode from 'vscode';
import * as https from 'https';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_AUTH_ENDPOINT,
    GOOGLE_TOKEN_ENDPOINT,
    GOOGLE_SCOPES,
} from './constants';
import { TokenStorage, TokenData } from './tokenStorage';
import { CallbackServer } from './callbackServer';

/**
 * 认证状态枚举
 */
export enum AuthState {
    NOT_AUTHENTICATED = 'not_authenticated',
    AUTHENTICATING = 'authenticating',
    AUTHENTICATED = 'authenticated',
    TOKEN_EXPIRED = 'token_expired',
    REFRESHING = 'refreshing',
    ERROR = 'error',
}

/**
 * 完整的认证状态信息
 */
export interface AuthStateInfo {
    state: AuthState;
    error?: string;
    email?: string;
}

/**
 * Token 响应类型
 */
interface TokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
    scope: string;
}

/**
 * 用户信息响应类型
 */
interface UserInfoResponse {
    id: string;
    email: string;
    verified_email: boolean;
    name?: string;
    picture?: string;
}

/**
 * Google OAuth 认证服务
 * 单例模式
 */
export class GoogleAuthService {
    private static instance: GoogleAuthService;
    private tokenStorage: TokenStorage;
    private callbackServer: CallbackServer | null = null;
    private context: vscode.ExtensionContext | null = null;
    private currentState: AuthState = AuthState.NOT_AUTHENTICATED;
    private lastError: string | undefined;
    private userEmail: string | undefined;
    private stateChangeListeners: Set<(state: AuthStateInfo) => void> = new Set();

    private constructor() {
        this.tokenStorage = TokenStorage.getInstance();
    }

    /**
     * 获取单例实例
     */
    public static getInstance(): GoogleAuthService {
        if (!GoogleAuthService.instance) {
            GoogleAuthService.instance = new GoogleAuthService();
        }
        return GoogleAuthService.instance;
    }

    /**
     * 初始化服务
     * @param context VS Code 扩展上下文
     */
    public async initialize(context: vscode.ExtensionContext): Promise<void> {
        console.log('[GoogleAuth] Initializing auth service...');
        this.context = context;
        this.tokenStorage.initialize(context);

        // 检查是否有存储的 Token
        const hasToken = await this.tokenStorage.hasToken();
        console.log('[GoogleAuth] Has stored token:', hasToken);

        if (hasToken) {
            const isExpired = await this.tokenStorage.isTokenExpired();
            console.log('[GoogleAuth] Token expired:', isExpired);

            if (isExpired) {
                // 尝试刷新 Token
                try {
                    console.log('[GoogleAuth] Attempting to refresh expired token...');
                    await this.refreshToken();
                    console.log('[GoogleAuth] Token refreshed successfully');
                } catch (e) {
                    // 刷新失败，但 refresh token 可能仍然有效
                    // 设置为 AUTHENTICATED，让后续请求再次尝试刷新
                    console.warn('[GoogleAuth] Token refresh failed during init, will retry later:', e);
                }
            }
            // 只要有存储的 token（包含 refresh token），就认为是已认证状态
            // 后续 getValidAccessToken() 会再次尝试刷新
            this.setState(AuthState.AUTHENTICATED);
            console.log('[GoogleAuth] Set state to AUTHENTICATED (has refresh token)');
        } else {
            this.setState(AuthState.NOT_AUTHENTICATED);
            console.log('[GoogleAuth] No stored token, user needs to login');
        }
    }

    /**
     * 检查是否已登录
     */
    public isAuthenticated(): boolean {
        return this.currentState === AuthState.AUTHENTICATED;
    }

    /**
     * 获取完整认证状态
     */
    public getAuthState(): AuthStateInfo {
        return {
            state: this.currentState,
            error: this.lastError,
            email: this.userEmail,
        };
    }

    /**
     * 发起 Google 登录流程
     * @returns 是否登录成功
     */
    public async login(): Promise<boolean> {
        console.log('[GoogleAuth] Login initiated, current state:', this.currentState);

        if (this.currentState === AuthState.AUTHENTICATING) {
            console.log('[GoogleAuth] Already authenticating, skipping');
            return false; // 正在登录中
        }

        try {
            this.setState(AuthState.AUTHENTICATING);

            // 生成 state 参数 (CSRF 保护)
            const state = crypto.randomBytes(32).toString('hex');
            console.log('[GoogleAuth] Generated state for CSRF protection');

            // 生成 PKCE code verifier 和 challenge
            const codeVerifier = crypto.randomBytes(32).toString('base64url');
            const codeChallenge = crypto
                .createHash('sha256')
                .update(codeVerifier)
                .digest('base64url');
            console.log('[GoogleAuth] Generated PKCE code challenge');

            // 启动回调服务器
            this.callbackServer = new CallbackServer();

            // 尝试加载图标
            try {
                if (this.context) {
                    const iconPath = path.join(this.context.extensionPath, 'icon.png');
                    if (fs.existsSync(iconPath)) {
                        const iconBuffer = fs.readFileSync(iconPath);
                        const iconBase64 = `data:image/png;base64,${iconBuffer.toString('base64')}`;
                        this.callbackServer.setIcon(iconBase64);
                        console.log('[GoogleAuth] Loaded plugin icon for callback page');
                    }
                }
            } catch (iconError) {
                console.warn('[GoogleAuth] Failed to load icon for callback page:', iconError);
            }

            // 等待服务器启动并获取端口
            await this.callbackServer.startServer();

            // 获取重定向 URI（服务器已启动，端口已分配）
            const redirectUri = this.callbackServer.getRedirectUri();
            console.log('[GoogleAuth] Callback server started, redirect URI:', redirectUri);

            // 构建授权 URL
            const authUrl = this.buildAuthUrl(redirectUri, state, codeChallenge);
            console.log('[GoogleAuth] Opening browser for authorization...');

            // 开始等待回调（此时设置请求处理器）
            const callbackPromise = this.callbackServer.waitForCallback(state);

            // 在浏览器中打开授权页面
            await vscode.env.openExternal(vscode.Uri.parse(authUrl));

            // 等待回调
            console.log('[GoogleAuth] Waiting for OAuth callback...');
            const result = await callbackPromise;
            console.log('[GoogleAuth] Received authorization code, exchanging for token...');

            // 交换 authorization code 获取 Token
            const tokenData = await this.exchangeCodeForToken(
                result.code,
                redirectUri,
                codeVerifier
            );
            console.log('[GoogleAuth] Token exchange successful, expires at:', new Date(tokenData.expiresAt).toISOString());

            // 保存 Token
            await this.tokenStorage.saveToken(tokenData);
            console.log('[GoogleAuth] Token saved to secure storage');

            this.setState(AuthState.AUTHENTICATED);
            vscode.window.showInformationMessage('Google 账号登录成功！');
            return true;
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.error('[GoogleAuth] Login failed:', errorMessage);
            if (e instanceof Error && e.stack) {
                console.error('[GoogleAuth] Stack:', e.stack);
            }
            this.lastError = errorMessage;
            this.setState(AuthState.ERROR);
            vscode.window.showErrorMessage(`Google 登录失败: ${errorMessage}`);
            return false;
        } finally {
            // 确保服务器已关闭
            if (this.callbackServer) {
                this.callbackServer.stop();
                this.callbackServer = null;
                console.log('[GoogleAuth] Callback server stopped');
            }
        }
    }

    /**
     * 登出并清除 Token
     * @returns 是否实际执行了登出操作（之前是否已登录）
     */
    public async logout(): Promise<boolean> {
        const wasAuthenticated = this.currentState === AuthState.AUTHENTICATED || 
                                  this.currentState === AuthState.TOKEN_EXPIRED ||
                                  this.currentState === AuthState.REFRESHING;
        
        await this.tokenStorage.clearToken();
        this.userEmail = undefined;
        this.lastError = undefined;
        this.setState(AuthState.NOT_AUTHENTICATED);
        
        return wasAuthenticated;
    }

    /**
     * 使用已有的 refresh_token 登录（从 Antigravity 本地数据库导入）
     * @param refreshToken 从 Antigravity 提取的 refresh_token
     * @returns 是否登录成功
     */
    public async loginWithRefreshToken(refreshToken: string): Promise<boolean> {
        console.log('[GoogleAuth] Attempting login with imported refresh_token');

        if (this.currentState === AuthState.AUTHENTICATING || this.currentState === AuthState.REFRESHING) {
            console.log('[GoogleAuth] Already authenticating/refreshing, skipping');
            return false;
        }

        try {
            this.setState(AuthState.REFRESHING);

            // 使用 refresh_token 获取新的 access_token
            const params = new URLSearchParams({
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
            });

            console.log('[GoogleAuth] Sending token refresh request with imported refresh_token...');
            const response = await this.makeTokenRequest(params);
            console.log('[GoogleAuth] Token refresh response received, expires_in:', response.expires_in);

            // 构建 TokenData 并保存
            const tokenData: TokenData = {
                accessToken: response.access_token,
                refreshToken: refreshToken, // 使用导入的 refresh_token
                expiresAt: Date.now() + response.expires_in * 1000,
                tokenType: response.token_type,
                scope: response.scope,
                source: 'imported',  // 从本地 Antigravity 导入
            };

            await this.tokenStorage.saveToken(tokenData);
            console.log('[GoogleAuth] Token saved to secure storage');

            this.setState(AuthState.AUTHENTICATED);
            vscode.window.showInformationMessage('已使用本地 Antigravity 账号登录成功！');
            return true;
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.error('[GoogleAuth] Login with refresh_token failed:', errorMessage);
            this.lastError = errorMessage;
            this.setState(AuthState.ERROR);
            vscode.window.showErrorMessage(`使用本地 Token 登录失败: ${errorMessage}`);
            return false;
        }
    }

    /**
     * 将 Token 来源转换为手动登录（用户选择不同步时调用）
     * 这样后续不会再触发同步校验
     */
    public async convertToManualSource(): Promise<void> {
        try {
            await this.tokenStorage.updateTokenSource('manual');
            console.log('[GoogleAuth] Token source converted to manual');
        } catch (e) {
            console.error('[GoogleAuth] Failed to convert token source:', e);
        }
    }

    /**
     * 获取当前 Token 来源
     * @returns Token 来源，'manual' 或 'imported'
     */
    public async getTokenSource(): Promise<'manual' | 'imported'> {
        return await this.tokenStorage.getTokenSource();
    }

    /**
     * 获取有效的 Access Token
     * 如果 Token 已过期会自动刷新
     * @throws 如果无法获取有效 Token
     */
    public async getValidAccessToken(): Promise<string> {
        console.log('[GoogleAuth] Getting valid access token...');
        const token = await this.tokenStorage.getToken();
        if (!token) {
            console.log('[GoogleAuth] No token found');
            this.setState(AuthState.NOT_AUTHENTICATED);
            throw new Error('Not authenticated');
        }

        // 检查是否需要刷新 (提前 5 分钟)
        const isExpired = await this.tokenStorage.isTokenExpired();
        if (isExpired) {
            console.log('[GoogleAuth] Token expired or expiring soon, refreshing...');
            await this.refreshToken();
        }

        const accessToken = await this.tokenStorage.getAccessToken();
        if (!accessToken) {
            console.error('[GoogleAuth] Failed to get access token after refresh');
            throw new Error('Failed to get access token');
        }
        console.log('[GoogleAuth] Access token obtained:', this.maskToken(accessToken));
        return accessToken;
    }

    /**
     * 监听认证状态变化
     * @param callback 状态变化回调
     * @returns Disposable
     */
    public onAuthStateChange(callback: (state: AuthStateInfo) => void): vscode.Disposable {
        this.stateChangeListeners.add(callback);
        return {
            dispose: () => {
                this.stateChangeListeners.delete(callback);
            }
        };
    }

    /**
     * 获取当前登录用户的邮箱
     * @returns 用户邮箱，未登录或获取失败返回 undefined
     */
    public getUserEmail(): string | undefined {
        return this.userEmail;
    }

    /**
     * 获取用户信息（包括邮箱）
     * @param accessToken OAuth access token
     * @returns 用户信息
     */
    public async fetchUserInfo(accessToken: string): Promise<UserInfoResponse> {
        console.log('[GoogleAuth] Fetching user info...');
        return new Promise((resolve, reject) => {
            const options: https.RequestOptions = {
                hostname: 'www.googleapis.com',
                port: 443,
                path: '/oauth2/v2/userinfo',
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
            };

            const req = https.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            const response = JSON.parse(data) as UserInfoResponse;
                            console.log('[GoogleAuth] User info fetched, email:', response.email);
                            // 缓存邮箱
                            this.userEmail = response.email;
                            resolve(response);
                        } else {
                            reject(new Error(`Failed to fetch user info: ${res.statusCode} - ${data}`));
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse user info response: ${data}`));
                    }
                });
            });

            req.on('error', (e) => {
                reject(e);
            });

            req.end();
        });
    }

    /**
     * 刷新 Token
     */
    private async refreshToken(): Promise<void> {
        console.log('[GoogleAuth] Refreshing token...');
        this.setState(AuthState.REFRESHING);

        try {
            const refreshToken = await this.tokenStorage.getRefreshToken();
            if (!refreshToken) {
                console.error('[GoogleAuth] No refresh token available');
                throw new Error('No refresh token available');
            }
            console.log('[GoogleAuth] Using refresh token:', this.maskToken(refreshToken));

            const params = new URLSearchParams({
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
            });

            console.log('[GoogleAuth] Sending token refresh request to Google...');
            const response = await this.makeTokenRequest(params);
            console.log('[GoogleAuth] Token refresh response received, expires_in:', response.expires_in);

            // 更新 access token
            await this.tokenStorage.updateAccessToken(
                response.access_token,
                response.expires_in
            );
            console.log('[GoogleAuth] Access token updated successfully');

            this.setState(AuthState.AUTHENTICATED);
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.error('[GoogleAuth] Token refresh failed:', errorMessage);
            this.lastError = errorMessage;
            this.setState(AuthState.TOKEN_EXPIRED);
            throw e;
        }
    }

    /**
     * 遮蔽 token，只显示前6位和后4位
     */
    private maskToken(token: string): string {
        if (token.length <= 14) {
            return '***';
        }
        return `${token.substring(0, 6)}***${token.substring(token.length - 4)}`;
    }

    /**
     * 构建授权 URL
     */
    private buildAuthUrl(redirectUri: string, state: string, codeChallenge: string): string {
        const params = new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: GOOGLE_SCOPES,
            state: state,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            access_type: 'offline',
            prompt: 'consent',
        });

        return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
    }

    /**
     * 交换 authorization code 获取 Token
     */
    private async exchangeCodeForToken(
        code: string,
        redirectUri: string,
        codeVerifier: string
    ): Promise<TokenData> {
        const params = new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            code: code,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
            code_verifier: codeVerifier,
        });

        const response = await this.makeTokenRequest(params);

        if (!response.refresh_token) {
            throw new Error('No refresh token in response');
        }

        return {
            accessToken: response.access_token,
            refreshToken: response.refresh_token,
            expiresAt: Date.now() + response.expires_in * 1000,
            tokenType: response.token_type,
            scope: response.scope,
            source: 'manual',  // 手动登录
        };
    }

    /**
     * 发送 Token 请求
     */
    private makeTokenRequest(params: URLSearchParams): Promise<TokenResponse> {
        return new Promise((resolve, reject) => {
            const postData = params.toString();
            const url = new URL(GOOGLE_TOKEN_ENDPOINT);

            const options: https.RequestOptions = {
                hostname: url.hostname,
                port: 443,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(postData),
                },
            };

            const req = https.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        if (response.error) {
                            reject(new Error(`Token error: ${response.error} - ${response.error_description}`));
                        } else {
                            resolve(response as TokenResponse);
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse token response: ${data}`));
                    }
                });
            });

            req.on('error', (e) => {
                reject(e);
            });

            req.write(postData);
            req.end();
        });
    }

    /**
     * 设置状态并通知监听器
     */
    private setState(state: AuthState): void {
        const previousState = this.currentState;
        this.currentState = state;
        console.log(`[GoogleAuth] State changed: ${previousState} -> ${state}`);

        const stateInfo = this.getAuthState();
        this.stateChangeListeners.forEach((listener) => {
            try {
                listener(stateInfo);
            } catch (e) {
                console.error('[GoogleAuth] Auth state listener error:', e);
            }
        });
    }
}
