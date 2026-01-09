/**
 * Token 安全存储服务
 * 使用 VS Code SecretStorage API 加密存储 OAuth Token
 */

import * as vscode from 'vscode';
import { TOKEN_STORAGE_KEY } from './constants';

/**
 * Token 来源类型
 * - 'manual': 用户手动登录（浏览器授权）
 * - 'imported': 从本地 Antigravity 导入
 */
export type TokenSource = 'manual' | 'imported';

/**
 * OAuth Token 数据结构
 */
export interface TokenData {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;  // Unix timestamp (毫秒)
    tokenType: string;
    scope: string;
    source?: TokenSource;  // Token 来源，旧版本升级后为 undefined，视为 'manual'
}

/**
 * Token 存储服务
 * 使用 VS Code 的 SecretStorage API 安全存储 OAuth Token
 */
export class TokenStorage {
    private static instance: TokenStorage;
    private secretStorage: vscode.SecretStorage | null = null;

    private constructor() { }

    /**
     * 获取单例实例
     */
    public static getInstance(): TokenStorage {
        if (!TokenStorage.instance) {
            TokenStorage.instance = new TokenStorage();
        }
        return TokenStorage.instance;
    }

    /**
     * 初始化存储服务
     * @param context VS Code 扩展上下文
     */
    public initialize(context: vscode.ExtensionContext): void {
        this.secretStorage = context.secrets;
    }

    /**
     * 确保已初始化
     */
    private ensureInitialized(): void {
        if (!this.secretStorage) {
            throw new Error('TokenStorage not initialized. Call initialize() first.');
        }
    }

    /**
     * 保存 Token
     * @param token Token 数据
     */
    public async saveToken(token: TokenData): Promise<void> {
        this.ensureInitialized();
        const tokenJson = JSON.stringify(token);
        await this.secretStorage!.store(TOKEN_STORAGE_KEY, tokenJson);
    }

    /**
     * 读取 Token
     * @returns Token 数据，如果不存在则返回 null
     */
    public async getToken(): Promise<TokenData | null> {
        this.ensureInitialized();
        const tokenJson = await this.secretStorage!.get(TOKEN_STORAGE_KEY);
        if (!tokenJson) {
            return null;
        }
        try {
            return JSON.parse(tokenJson) as TokenData;
        } catch (e) {
            console.error('Failed to parse stored token:', e);
            return null;
        }
    }

    /**
     * 清除 Token
     */
    public async clearToken(): Promise<void> {
        this.ensureInitialized();
        await this.secretStorage!.delete(TOKEN_STORAGE_KEY);
    }

    /**
     * 检查是否有存储的 Token
     * @returns 是否有 Token
     */
    public async hasToken(): Promise<boolean> {
        const token = await this.getToken();
        return token !== null;
    }

    /**
     * 检查 Token 是否已过期
     * @param bufferMs 提前多少毫秒视为过期 (默认 5 分钟)
     * @returns 是否已过期
     */
    public async isTokenExpired(bufferMs: number = 5 * 60 * 1000): Promise<boolean> {
        const token = await this.getToken();
        if (!token) {
            return true;
        }
        return Date.now() + bufferMs >= token.expiresAt;
    }

    /**
     * 获取有效的 Access Token
     * 如果 Token 已过期，返回 null (调用方需要刷新或重新登录)
     * @returns Access Token 或 null
     */
    public async getAccessToken(): Promise<string | null> {
        const token = await this.getToken();
        if (!token) {
            return null;
        }
        // 检查是否过期 (提前 5 分钟)
        if (await this.isTokenExpired()) {
            return null;
        }
        return token.accessToken;
    }

    /**
     * 获取 Refresh Token
     * @returns Refresh Token 或 null
     */
    public async getRefreshToken(): Promise<string | null> {
        const token = await this.getToken();
        return token?.refreshToken ?? null;
    }

    /**
     * 使用新的 Access Token 更新存储 (刷新 Token 后调用)
     * @param accessToken 新的 Access Token
     * @param expiresIn Token 有效期 (秒)
     */
    public async updateAccessToken(accessToken: string, expiresIn: number): Promise<void> {
        const token = await this.getToken();
        if (!token) {
            throw new Error('No existing token to update');
        }
        token.accessToken = accessToken;
        token.expiresAt = Date.now() + expiresIn * 1000;
        await this.saveToken(token);
    }

    /**
     * 获取 Token 来源
     * @returns Token 来源，如果没有 token 或未设置则返回 'manual'（兼容旧版本）
     */
    public async getTokenSource(): Promise<TokenSource> {
        const token = await this.getToken();
        return token?.source ?? 'manual';
    }

    /**
     * 更新 Token 来源
     * @param source 新的来源
     */
    public async updateTokenSource(source: TokenSource): Promise<void> {
        const token = await this.getToken();
        if (!token) {
            throw new Error('No existing token to update');
        }
        token.source = source;
        await this.saveToken(token);
    }
}
