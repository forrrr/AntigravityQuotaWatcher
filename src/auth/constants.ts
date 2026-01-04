/**
 * Google OAuth 2.0 配置常量
 * 
 * 注意: 对于桌面应用程序，Client Secret 不被视为机密
 * 参考: https://developers.google.com/identity/protocols/oauth2/native-app
 */

// Google Cloud Code OAuth 客户端 ID
// 这是 Google Cloud Code 使用的官方 OAuth 客户端凭据
export const GOOGLE_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';

// Google Cloud Code OAuth 客户端密钥
// 对于已安装的应用程序，此密钥不被视为机密
export const GOOGLE_CLIENT_SECRET = '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';

// OAuth 2.0 端点
export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

// OAuth 权限作用域
// 需要访问 Cloud Code API 的作用域
export const GOOGLE_SCOPES = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cclog',
    'https://www.googleapis.com/auth/experimentsandconfigs'
].join(' ');

// Token 存储键名 (用于 VS Code SecretStorage)
export const TOKEN_STORAGE_KEY = 'antigravity-quota-watcher.google-oauth-token';

// Google Cloud Code API 端点
export const CLOUD_CODE_API_BASE = 'https://cloudcode-pa.googleapis.com';
export const LOAD_CODE_ASSIST_PATH = '/v1internal:loadCodeAssist';
export const FETCH_AVAILABLE_MODELS_PATH = '/v1internal:fetchAvailableModels';

// OAuth 回调服务器配置
export const CALLBACK_HOST = '127.0.0.1';
export const CALLBACK_PATH = '/callback';

// 超时配置 (毫秒)
export const AUTH_TIMEOUT_MS = 60000;  // 1 分钟
export const API_TIMEOUT_MS = 10000;   // 10 秒

// 重试配置
export const MAX_RETRIES = 3;
export const RETRY_DELAY_MS = 1000;
