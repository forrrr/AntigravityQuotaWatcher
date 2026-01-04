/**
 * Antigravity Quota Watcher - type definitions
 */

export interface ModelConfig {
  label: string;
  modelOrAlias: {
    model: string;
  };
  quotaInfo?: {
    remainingFraction?: number;
    resetTime: string;
  };
  supportsImages?: boolean;
  isRecommended?: boolean;
  allowedTiers?: string[];
}

export interface UserStatusResponse {
  userStatus: {
    name: string;
    email: string;
    planStatus?: {
      planInfo: {
        teamsTier: string;
        planName: string;
        monthlyPromptCredits: number;
        monthlyFlowCredits: number;
      };
      availablePromptCredits: number;
      availableFlowCredits: number;
    };
    cascadeModelConfigData?: {
      clientModelConfigs: ModelConfig[];
    };
    // 账号级别信息（如 Free、Pro）
    userTier?: {
      id: string;
      name: string;
      description: string;
    };
  };
}

export interface PromptCreditsInfo {
  available: number;
  monthly: number;
  usedPercentage: number;
  remainingPercentage: number;
}

export interface ModelQuotaInfo {
  label: string;
  modelId: string;
  remainingFraction?: number;
  remainingPercentage?: number;
  isExhausted: boolean;
  resetTime: Date;
  timeUntilReset: number;
  timeUntilResetFormatted: string;
}

export interface QuotaSnapshot {
  timestamp: Date;
  promptCredits?: PromptCreditsInfo;
  models: ModelQuotaInfo[];
  planName?: string;
  userEmail?: string;  // Google 账号邮箱 (仅 GOOGLE_API 方法)
  isStale?: boolean;   // 数据是否过时 (网络问题或超时)
}

export enum QuotaLevel {
  Normal = 'normal',
  Warning = 'warning',
  Critical = 'critical',
  Depleted = 'depleted'
}

export type ApiMethodPreference = /* 'COMMAND_MODEL_CONFIG' | */ 'GET_USER_STATUS' | 'GOOGLE_API';

export interface Config {
  enabled: boolean;
  pollingInterval: number;
  warningThreshold: number;
  criticalThreshold: number;
  apiMethod: ApiMethodPreference;
  showPromptCredits: boolean;
  showPlanName: boolean;
  showGeminiPro: boolean;
  showGeminiFlash: boolean;
  displayStyle: 'percentage' | 'progressBar' | 'dots';
  language: 'auto' | 'en' | 'zh-cn';
}
