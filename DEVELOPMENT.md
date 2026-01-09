# 👨‍💻 开发者指南 (Developer Guide)

本仓库采用 **双远程仓库 (Dual Remote)** 工作流。
这允许你同时：
1. **origin**: 维护你自己的修改和特性
2. **upstream**: 同步原作者的最新更新

## ✅ 仓库配置信息

| 远程名称 (Remote) | URL | 用途 |
| :--- | :--- | :--- |
| **origin** | `https://github.com/forrrr/AntigravityQuotaWatcher.git` | **你的 Fork** (推送自己的代码) |
| **upstream** | `https://github.com/wusimpl/AntigravityQuotaWatcher.git` | **原作者仓库** (拉取最新代码) |

查看当前配置：
```powershell
git remote -v
```

---

## 🚀 常用工作流

### 1. 同步原作者更新 (Sync with Upstream)
当你想要获取原作者的最新更新时，执行以下命令：

```powershell
# 1. 拉取 upstream 的更新
git fetch upstream

# 2. 切换到主分支 (通常是 main)
git checkout main

# 3. 合并更新 (如果无冲突，会自动合并)
git merge upstream/main
```

### 2. 推送修改到你的仓库 (Push to Origin)
当你完成开发后，将代码推送到你自己的仓库：

```powershell
git push origin main
```

### 3. (可选) 重新配置远程仓库
如果你换了电脑重新 clone，需要运行以下命令来恢复配置：

```powershell
# 1. 克隆你的仓库
git clone https://github.com/forrrr/AntigravityQuotaWatcher.git

# 2. 进入目录
cd AntigravityQuotaWatcher

# 3. 添加 upstream 上游仓库
git remote add upstream https://github.com/wusimpl/AntigravityQuotaWatcher.git
```
