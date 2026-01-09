import { TranslationMap } from './types';

export const zh_cn: TranslationMap = {
    // 状态栏
    'status.initializing': '⏳ 初始化中...',
    'status.detecting': '🔍 检测端口中...',
    'status.fetching': '$(sync~spin) 获取配额中...',
    'status.retrying': '$(sync~spin) 重试中 ({current}/{max})...',
    'status.error': '$(error) Antigravity Quota Watcher: 错误',
    'status.refreshing': '$(sync~spin) 刷新中...',
    'status.notLoggedIn': '$(account) 未登录，点击登录',
    'status.loggingIn': '$(sync~spin) 登录中...',
    'status.loginExpired': '$(warning) 登录已过期，点击重新登录',
    'status.stale': '⏸️',

    // hover 提示框
    'tooltip.title': '**Antigravity 模型配额**',
    'tooltip.credits': '💳 **提示词额度**',
    'tooltip.available': '可用',
    'tooltip.remaining': '剩余',
    'tooltip.depleted': '⚠️ **已耗尽**',
    'tooltip.resetTime': '重置时间',
    'tooltip.model': '模型',
    'tooltip.status': '剩余',
    'tooltip.error': '获取配额信息时出错。',
    'tooltip.clickToRetry': '点击重试',
    'tooltip.clickToLogin': '点击登录 Google 账号',
    'tooltip.clickToRelogin': '登录已过期，点击重新登录',
    'tooltip.staleWarning': '⚠️ 数据可能已过时（网络问题或超时）',

    // 通知弹窗 (vscode.window.show*Message)
    'notify.unableToDetectProcess': 'Antigravity Quota Watcher: 无法检测到 Antigravity 进程。',
    'notify.retry': '重试',
    'notify.cancel': '取消',
    'notify.refreshingQuota': '🔄 正在刷新配额...',
    'notify.detectionSuccess': '✅ 检测成功！端口: {port}',
    'notify.unableToDetectPort': '❌ 无法检测到有效端口。请确保：',
    'notify.unableToDetectPortHint1': '1. 已在Antigravity登录 Google 账户 2. Antigravity为运行状态',
    'notify.unableToDetectPortHint2': '3. 系统有权限运行检测命令 4. 科学上网连接正常',
    'notify.portDetectionFailed': '❌ 端口检测失败: {error}',
    'notify.configUpdated': 'Antigravity Quota Watcher 配置已更新',
    'notify.nonAntigravityDetected': '检测到非 Antigravity 环境，推荐使用 Google API 方式获取配额。',
    'notify.switchToGoogleApi': '切换',
    'notify.keepLocalApi': '不切换',
    'notify.neverShowAgain': '不再提示',
    'notify.portCommandRequired': '端口检测需要 lsof、ss 或 netstat。请安装其中之一',
    'notify.portCommandRequiredDarwin': '端口检测需要 lsof 或 netstat。请安装其中之一',
    'notify.googleApiNoPortDetection': 'Google API 方法不需要端口检测。请使用 Google 登录功能。',
    'notify.pleaseLoginFirst': '请先登录 Google 账号',

    // 登录错误
    'login.error.serviceNotInitialized': '认证服务尚未初始化',
    'login.error.authFailed': '认证失败',

    // 本地 Token 检测
    'notify.localTokenDetected': '检测到本地 Antigravity 已登录，是否使用该账号？',
    'notify.useLocalToken': '使用本地 Token 登录',
    'notify.manualLogin': '手动登录',

    // Token 同步检查
    'notify.tokenChanged': '检测到 Antigravity 账号已变更，是否同步？',
    'notify.tokenRemoved': '检测到 Antigravity 已退出登录，是否同步退出？',
    'notify.syncToken': '同步',
    'notify.keepCurrentToken': '保持当前',
    'notify.syncLogout': '同步退出',
    'notify.keepLogin': '保持登录'
};
