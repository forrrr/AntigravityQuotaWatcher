# ⚙️ 配置选项

打开 VS Code 设置（`文件` > `首选项` > `设置`），搜索 `Antigravity Quota Watcher`：

## 启用自动监控
- **默认值**：`true`
- **说明**：是否启用配额监控

## 轮询间隔
- **默认值**：`60`（秒）
- **说明**：配额数据刷新频率，建议设置为 30-60 秒

## 警告阈值
- **默认值**：`50`（百分比）
- **说明**：配额低于此百分比时状态栏显示黄色警告符号（🟡）

## 临界阈值
- **默认值**：`30`（百分比）
- **说明**：配额低于此百分比时状态栏显示红色错误符号（🔴）

## 状态栏显示样式
- **默认值**：`progressBar`
- **选项**：
  - `progressBar`：显示进度条（ `████░░░░`）
  - `percentage`：显示百分比（ `80%`）
  - `dots`：显示圆点（ `●●●○○`）
- **说明**：选择状态栏的显示风格

## API 方法选择
- **默认值**：`GET_USER_STATUS`
- **选项**：
  - `GOOGLE_API`：**推荐使用** - 直接调用 Google Cloud Code API 获取配额，数据基本是最新的，响应快速
  - `GET_USER_STATUS`：兼容模式 - 通过本地 Antigravity 语言服务器获取配额，存在较大延迟（因为依赖 LSP）
- **说明**：选择配额获取方式

### Google API 方式使用说明
>
> **致谢**：Google API 配额获取方法来自 [Antigravity-Manager](https://github.com/lbjlaq/Antigravity-Manager) 项目，感谢作者的贡献！

如果选择 `GOOGLE_API` 方法，需要使用 Google 账号登录：

**登录方式**：
1. 点击右下角插件状态栏提示语
2. 在浏览器中完成 Google 账号授权
3. 授权成功后插件会自动开始获取配额

**登出方式**：
1. 打开命令面板（`Ctrl+Shift+P` 或 `Cmd+Shift+P`）
2. 输入并执行 `Antigravity Quota Watcher: Google Logout`

## PowerShell 模式（仅 Windows 系统可用）
- **默认值**：`true`，如果false，则使用wmic检测进程
- **说明**：使用 PowerShell 模式检测进程
- **适用场景**：如果在 Windows 系统上遇到端口检测错误，可以尝试切换此选项。插件重启生效。

## 显示 Gemini 3 Pro (G Pro) 额度
- **默认值**：`true`
- **说明**：是否在状态栏显示 Gemini Pro 的额度信息

## 显示 Gemini 3 Flash (G Flash) 额度
- **默认值**：`true`
- **说明**：是否在状态栏显示 Gemini Flash 的额度信息

## 显示账号级别
- **默认值**：`false`
- **说明**：是否在状态栏显示账号级别（如 Free、Pro）

## 语言设置
- **默认值**：`auto`
- **选项**：
  - `auto`：自动跟随 VS Code 语言设置
  - `en`：英语
  - `zh-cn`：简体中文
- **说明**：设置状态栏语言，默认自动跟随 VS Code 语言
> 如果要更改配置设置页面的显示语言，需要将antigravity的语言设置为中文
