/**
 * OAuth 回调 HTTP 服务器
 * 启动临时本地服务器接收 Google OAuth 回调
 */

import * as http from 'http';
import { CALLBACK_HOST, CALLBACK_PATH, AUTH_TIMEOUT_MS } from './constants';

/**
 * OAuth 回调结果
 */
export interface CallbackResult {
  code: string;  // Authorization code
  state?: string; // 状态参数 (用于 CSRF 保护)
}

/**
 * 回调服务器类
 * 启动临时 HTTP 服务器接收 OAuth 回调
 */
export class CallbackServer {
  private server: http.Server | null = null;
  private port: number = 0;
  private iconBase64: string | null = null;

  /**
   * 设置页面显示的图标 (Base64)
   */
  public setIcon(base64: string): void {
    this.iconBase64 = base64;
  }

  /**
   * 获取回调 URL
   * @returns 回调 URL
   */
  public getRedirectUri(): string {
    if (this.port === 0) {
      throw new Error('Server not started');
    }
    return `http://${CALLBACK_HOST}:${this.port}${CALLBACK_PATH}`;
  }

  /**
   * 启动服务器监听
   * 等待服务器开始监听后返回，之后可以调用 getRedirectUri() 获取回调地址
   */
  public startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer();

      // 监听随机端口
      this.server.listen(0, CALLBACK_HOST, () => {
        const address = this.server!.address();
        if (typeof address === 'object' && address !== null) {
          this.port = address.port;
          console.log(`OAuth callback server listening on port ${this.port}`);
          resolve();
        } else {
          reject(new Error('Failed to get server address'));
        }
      });

      // 处理服务器错误
      this.server.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * 等待 OAuth 回调
   * 必须先调用 startServer() 启动服务器
   * @param expectedState 期望的 state 参数 (CSRF 保护)
   * @returns Promise<CallbackResult> 回调结果
   */
  public waitForCallback(expectedState: string): Promise<CallbackResult> {
    if (this.port === 0) {
      return Promise.reject(new Error('Server not started. Call startServer() first.'));
    }

    return new Promise((resolve, reject) => {
      // 创建超时定时器
      const timeout = setTimeout(() => {
        this.stop();
        reject(new Error('OAuth callback timeout'));
      }, AUTH_TIMEOUT_MS);

      // 设置请求处理器
      this.server!.on('request', (req, res) => {
        const url = new URL(req.url || '', `http://${CALLBACK_HOST}`);

        // 只处理回调路径
        if (url.pathname !== CALLBACK_PATH) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }

        // 解析参数
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');

        // 清除超时
        clearTimeout(timeout);

        // 检查错误
        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(this.getErrorHtml(error, errorDescription || 'Unknown error'));
          this.stop();
          reject(new Error(`OAuth error: ${error} - ${errorDescription}`));
          return;
        }

        // 验证 authorization code
        if (!code) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(this.getErrorHtml('missing_code', 'No authorization code received'));
          this.stop();
          reject(new Error('No authorization code received'));
          return;
        }

        // 验证 state (CSRF 保护)
        if (state !== expectedState) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(this.getErrorHtml('invalid_state', 'Invalid state parameter'));
          this.stop();
          reject(new Error('Invalid state parameter (CSRF protection)'));
          return;
        }

        // 返回成功页面
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(this.getSuccessHtml());

        // 停止服务器并返回结果
        this.stop();
        resolve({ code, state });
      });
    });
  }

  /**
   * 停止服务器
   */
  public stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.port = 0;
    }
  }

  /**
   * 生成成功 HTML 页面
   */
  private getSuccessHtml(): string {
    return `
<!DOCTYPE html>
<html lang="zh-CN" class="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>登录成功 - Antigravity Quota Watcher</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          fontFamily: {
            sans: ['Inter', 'sans-serif'],
          },
          colors: {
            border: "hsl(var(--border))",
            input: "hsl(var(--input))",
            ring: "hsl(var(--ring))",
            background: "hsl(var(--background))",
            foreground: "hsl(var(--foreground))",
            primary: {
              DEFAULT: "hsl(var(--primary))",
              foreground: "hsl(var(--primary-foreground))",
            },
            muted: {
              DEFAULT: "hsl(var(--muted))",
              foreground: "hsl(var(--muted-foreground))",
            },
            card: {
              DEFAULT: "hsl(var(--card))",
              foreground: "hsl(var(--card-foreground))",
            },
          },
        },
      },
    }
  </script>
  <style>
    :root {
      --background: 240 10% 3.9%;
      --foreground: 0 0% 98%;
      --card: 240 10% 3.9%;
      --card-foreground: 0 0% 98%;
      --primary: 0 0% 98%;
      --primary-foreground: 240 5.9% 10%;
      --muted: 240 3.7% 15.9%;
      --muted-foreground: 240 5% 64.9%;
      --border: 240 3.7% 15.9%;
    }
  </style>
</head>
<body class="bg-background text-foreground flex items-center justify-center min-h-screen antialiased selection:bg-primary/20">
  <div class="w-full max-w-md p-4 animate-in fade-in zoom-in duration-500">
    <div class="bg-card border border-border rounded-xl shadow-2xl p-8 text-center relative overflow-hidden">
      <div class="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-48 bg-primary/10 blur-[50px] rounded-full -z-10"></div>
      
      <div class="flex flex-col items-center mb-8">
        ${this.iconBase64 ? `<img src="${this.iconBase64}" class="h-20 w-auto drop-shadow-xl" alt="Logo">` : ''}
      </div>

      <h3 class="text-sm font-medium text-muted-foreground tracking-wider mb-2">Antigravity Quota Watcher</h3>
      <h1 class="text-3xl font-bold tracking-tight mb-4">登录成功</h1>
      <p class="text-muted-foreground leading-relaxed">
        您可以关闭此页面并返回 <span class="font-semibold text-foreground">Antigravity</span>。
      </p>
      <p class="text-muted-foreground leading-relaxed">
        Login successful, you can close this page and return to Antigravity.
      </p>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * 生成错误 HTML 页面
   */
  private getErrorHtml(error: string, description: string): string {
    return `
<!DOCTYPE html>
<html lang="zh-CN" class="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>登录失败 - Antigravity Quota Watcher</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          fontFamily: {
            sans: ['Inter', 'sans-serif'],
          },
          colors: {
            border: "hsl(var(--border))",
            input: "hsl(var(--input))",
            ring: "hsl(var(--ring))",
            background: "hsl(var(--background))",
            foreground: "hsl(var(--foreground))",
            destructive: {
              DEFAULT: "hsl(var(--destructive))",
              foreground: "hsl(var(--destructive-foreground))",
            },
            muted: {
              DEFAULT: "hsl(var(--muted))",
              foreground: "hsl(var(--muted-foreground))",
            },
            card: {
              DEFAULT: "hsl(var(--card))",
              foreground: "hsl(var(--card-foreground))",
            },
          },
        },
      },
    }
  </script>
  <style>
    :root {
      --background: 240 10% 3.9%;
      --foreground: 0 0% 98%;
      --card: 240 10% 3.9%;
      --card-foreground: 0 0% 98%;
      --destructive: 0 62.8% 30.6%;
      --destructive-foreground: 0 0% 98%;
      --muted: 240 3.7% 15.9%;
      --muted-foreground: 240 5% 64.9%;
      --border: 240 3.7% 15.9%;
    }
  </style>
</head>
<body class="bg-background text-foreground flex items-center justify-center min-h-screen antialiased selection:bg-destructive/20">
  <div class="w-full max-w-md p-4 animate-in fade-in zoom-in duration-500">
    <div class="bg-card border border-border rounded-xl shadow-2xl p-8 text-center relative overflow-hidden">
      <div class="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-48 bg-destructive/10 blur-[50px] rounded-full -z-10"></div>
      
      <div class="flex flex-col items-center mb-8">
        ${this.iconBase64 ? `<img src="${this.iconBase64}" class="h-20 w-auto mb-6 drop-shadow-xl opacity-50 grayscale" alt="Logo">` : ''}
        <div class="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center text-destructive">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x"><path d="M18 6 6 18"/><path d="m6 6 18 18"/></svg>
        </div>
      </div>

      <h3 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">Antigravity Quota Watcher</h3>
      <h1 class="text-3xl font-bold tracking-tight mb-4">登录失败</h1>
      <p class="text-muted-foreground leading-relaxed mb-4">
        ${this.escapeHtml(description)}
      </p>
      <div class="bg-muted/50 rounded-lg p-3 text-xs font-mono text-muted-foreground border border-border/50">
        错误代码: ${this.escapeHtml(error)}
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * HTML 转义
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

