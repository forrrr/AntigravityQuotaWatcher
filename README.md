# <img src="./icon.png" width="80" style="vertical-align: middle"> Antigravity Quota Watcher

#### Choose Your Language:  简体中文 | [English](./README.en.md)

> [!NOTE]
> 本插件为非官方工具，与 Antigravity 没有任何关联。
> 本插件部分依赖于 Antigravity 语言服务器的内部实现细节，相关机制可能会随时变动。

> [!NOTE]
>  本插件从V0.9.0版本开始支持 VS Code fork IDE（WindSurf, Kiro, VS Code 等）。
> 如需使用，请在配置中切换到**GOOGLE_API**方式获取模型配额（该方法需要登录Google账号），
> 该方法不依赖于 Antigravity 本地环境，远程SSH项目也适合这种方法。

> [!NOTE]
> 号外号外！本仓库为vscode插件版，[桌面版](https://github.com/wusimpl/AntigravityQuotaWatcherDesktop)已发布，欢迎下载体验

**一个在Antigravity状态栏实时显示AI模型配额剩余情况的插件。**

## 演示

<table>
  <tr>
    <td align="center">
      <strong>状态栏显示</strong><br><br>
      <img src="https://raw.githubusercontent.com/wusimpl/AntigravityQuotaWatcher/main/images/demo1.png" alt="状态栏显示" width="300">
    </td>
    <td align="center">
      <strong>配额详情</strong><br><br>
      <img src="https://raw.githubusercontent.com/wusimpl/AntigravityQuotaWatcher/main/images/demo2.png" alt="配额详情" width="400">
    </td>
    <td align="center">
      <strong>配置页面<a href="./CONFIG.md">(配置文档)</a></strong><br><br>
      <img src="https://raw.githubusercontent.com/wusimpl/AntigravityQuotaWatcher/main/images/demo3.png" alt="配置页面" width="400">
    </td>
  </tr>
</table>

## 系统要求

![Windows](https://img.shields.io/badge/Windows--amd64-支持-brightgreen?logo=microsoftwindows&logoColor=white)
![macOS](https://img.shields.io/badge/macOS-支持-brightgreen?logo=apple&logoColor=white)
![Linux](https://img.shields.io/badge/Linux-支持-brightgreen?logo=linux&logoColor=white)
![Windows ARM](https://img.shields.io/badge/Windows--arm64-不支持-red?logo=microsoftwindows&logoColor=white)

## 安装方法


### 方式一：插件市场安装（推荐）

在插件市场搜索 `wusimpl Antigravity Quota Watcher @sort:name`，认准作者为 `wusimpl` 的插件，点击安装即可。

![OpenVSX-Search PNG](./images/openvsx-search.png)

### 方式二：手动安装

[下载插件](https://github.com/wusimpl/AntigravityQuotaWatcher/releases/latest)，然后安装插件，重启 Antigravity

![Installation](https://raw.githubusercontent.com/wusimpl/AntigravityQuotaWatcher/main/images/install.png)

> [!NOTE]
> Linux系统平台须知：请确保系统支持以下三种命令之一：`lsof`、`netstat`、`ss`。如果没有，请安装后再重启脚本。

## 提交Issue

请在提交issue时附上日志文件或者日志截图

日志导出方法：
![步骤页面1](https://raw.githubusercontent.com/wusimpl/AntigravityQuotaWatcher/main/images/issue1.png)
![步骤页面2](https://raw.githubusercontent.com/wusimpl/AntigravityQuotaWatcher/main/images/issue2.png)


##  功能特点

- **实时监控**：自动检测并定时轮询配额使用情况
- **状态栏显示**：在 VS Code 底部状态栏显示当前配额
- **智能预警**：配额不足时自动变色提醒
- **自动检测**：无需手动配置，自动检测 Antigravity 服务端口和认证信息

##  配置选项

详细配置说明请查看：**[📖 配置文档](./CONFIG.md)**


### 命令面板

按 `Ctrl+Shift+P`（Windows）或 `Cmd+Shift+P`（Mac）打开命令面板，输入以下命令：

- **Antigravity: 刷新配额** - 手动刷新配额数据
- **Antigravity: 重新检测端口** - 重新检测 Antigravity 服务端口


## 状态栏说明

状态栏显示格式：

### 1. 进度条模式
显示格式：`🟢 Pro-L ████████ | 🔴 Claude ██░░░░░░`
直观展示剩余配额的比例。

### 2. 百分比模式（默认）
显示格式：`🟢 Pro-L: 80% | 🔴 Claude: 25%`
直接显示剩余配额的百分比数值。

### 3. 圆点模式
显示格式：`🟢 Pro-L ●●●●○ | 🔴 Claude ●●○○○`
使用圆点直观表示剩余配额比例，更加简洁美观。

### 状态指示符号

每个模型前的圆点符号表示当前配额状态：

- **🟢 绿色**：剩余配额 ≥ 50%（充足）
- **🟡 黄色**：剩余配额 30%-50%（中等）
- **🔴 红色**：剩余配额 < 30%（不足）
- **⚫ 黑色**：配额已耗尽（0%）

您可以在设置中自定义 `warningThreshold`（警告阈值）和 `criticalThreshold`（临界阈值）来调整状态符号的显示级别。

### 模型配额详情

鼠标移动到状态栏会显示所有模型的剩余配额与下次重置时间。**点击状态栏可以立即刷新配额信息**。

## 注意事项

- 首次启动会延迟 8 秒开始监控，避免频繁请求
- 如果状态栏显示错误，可使用"重新检测端口"命令修复
- **Windows 用户**：如果遇到端口检测错误，可以在设置中切换 `forcePowerShell` 选项。

## 致谢
 * Google API 配额获取方法来自 [Antigravity-Manager](https://github.com/lbjlaq/Antigravity-Manager) 项目，感谢作者的贡献！
 * 参考了 [anti-quota](https://github.com/fhyfhy17/anti-quota) 获取 Antigravity 本地登录账号Token的方法，感谢作者的贡献！

[![Star History Chart](https://api.star-history.com/svg?repos=wusimpl/AntigravityQuotaWatcher&type=date&legend=top-left)](https://www.star-history.com/#wusimpl/AntigravityQuotaWatcher&type=date&legend=top-left)

## 项目使用约定

本项目基于 MIT 协议开源，使用此项目时请遵守开源协议。  
除此外，希望你在使用代码时已经了解以下额外说明：

1. 打包、二次分发 **请保留代码出处**：[https://github.com/wusimpl/AntigravityQuotaWatcher](https://github.com/wusimpl/AntigravityQuotaWatcher)
2. 请不要用于商业用途，合法合规使用代码
3. 如果开源协议变更，将在此 Github 仓库更新，不另行通知。

## 许可证

MIT License
