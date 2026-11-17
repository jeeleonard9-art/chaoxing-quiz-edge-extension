# 超星学习通全自动答题助手 (Microsoft Edge 浏览器插件)

[中文文档](README.md) | [English Documentation](README_EN.md)

基于 **Manifest V3** 规范开发的现代化 Edge 浏览器插件。复用并升华了底层自动化答题脚本的核心设计，实现学习通网页端作业/测验全自动识别题目、调用大模型 API 智能推理、模拟拟真键鼠事件作答、先暂存后提交并立即停止的完整自动化闭环。

---

## ⚡ 一键下载与安装 (Quick Download & Install)

> [!TIP]
> ### 📦 一键下载链接（即下即用）
> - 🚀 **[直接下载最新打包扩展 (.zip) - v1.0.0](https://github.com/jeeleonard9-art/chaoxing-quiz-edge-extension/releases/download/v1.0.0/chaoxing-quiz-edge-extension-v1.0.0.zip)**（推荐：解压后直接在 Edge 载入）
> - 🏷️ **[查看 GitHub Releases 发布页](https://github.com/jeeleonard9-art/chaoxing-quiz-edge-extension/releases)**
> - 📂 **[一键下载主分支源码压缩包 (main.zip)](https://github.com/jeeleonard9-art/chaoxing-quiz-edge-extension/archive/refs/heads/main.zip)**

### 🧩 关于一键跳转 `edge://extensions/` 的说明与极简安装
> [!NOTE]
> 任何网页（包括 GitHub）出于浏览器底层**安全沙箱（Security Sandbox）**防护规则，均**被禁止通过网页超链接直接调起特权协议 `edge://` 或 `chrome://`**，防止恶意网站私自篡改扩展或提权。
>
> **极简 3 步安装运行**：
> 1. 下载上方的 **[v1.0.0 扩展安装包 (.zip)](https://github.com/jeeleonard9-art/chaoxing-quiz-edge-extension/releases/download/v1.0.0/chaoxing-quiz-edge-extension-v1.0.0.zip)** 并解压到电脑任意目录；
> 2. 打开 Edge 浏览器，在地址栏复制或输入以下地址并回车：
>    ```text
>    edge://extensions/
>    ```
> 3. 打开页面上的 **「开发人员模式」** 开关，点击 **「加载解压缩的扩展」**，选中解压出的文件夹即可完成安装！
>
> *(注：若后续将本扩展上架至 [Microsoft Edge 外接程序商店 (Edge Add-ons)](https://microsoftedge.microsoft.com/addons)，届时可直接通过官方商店网页链接实现真正的一键安装。)*

---

---

## ✨ 核心特性

1. **精准题目识别与穿透**：
   - 完美适配超星学习通多层 `iframe`（如章节测验、课件内嵌测验、独立作业作答页）。
   - 全面支持 **单选题、多选题、判断题、填空题、简答题/主观题** 的 DOM 结构提取与清洗。
2. **大模型 API 自由接入**：
   - 默认预置并完全兼容大模型 **`Agnes-3.0-flash`**。
   - 兼容 OpenAI 标准格式（`/v1/chat/completions`）及各大代理/中转接口（如 Gemini、GPT-4o、DeepSeek、Qwen 等）。
   - 在 `background.js` Service Worker 中发起请求，彻底规避网页端 CSP 策略与跨域（CORS）拦截。
3. **真实拟真键鼠交互**：
   - **选择题/判断题**：严格派发完整鼠标事件链（`pointerover` → `mouseover` → `pointerdown` → `mousedown` → `pointerup` → `mouseup` → `click`），保留真实停顿间隔，多选题按顺序逐一点击，并实时回读校验选中状态。
   - **填空题/简答题**：对输入框触发 `focus()` 与拟真键盘事件（`keydown` → `keypress` → `input` → `keyup` → `change`），并打通 `content_script` 与网页端主执行上下文（Main World），实现 UEditor 富文本编辑器与底层 `<textarea>` 的实时双向数据同步（`UE.sync()`）。
4. **严格的提交流程与终止条件**：
   - 严格按顺序执行：**先点击「暂时保存」**（等待保存完成与网络状态稳定 2 秒） → **再点击「提交」**。
   - 自动识别并确认二次弹窗；如检测到平台提示“未做完/有未答题目”，**自动启动安全拦截**，绝不盲目误交。
   - 提交成功后**立刻停止全部脚本执行**，严禁刷新、跳转或切换章节，确保作答安全。

---

## 🚀 安装步骤 (Edge 浏览器)

1. 打开 Microsoft Edge 浏览器，在地址栏输入并访问：
   ```text
   edge://extensions/
   ```
2. 在扩展页面左下角或右上角，开启 **「开发人员模式」**（Developer mode）开关。
3. 点击顶部的 **「加载解压缩的扩展」**（Load unpacked）按钮。
4. 在弹出的文件选择器中，选中本插件的根目录：
   ```text
   E:\ai_tools\gemini _anti\chaoxing-edge-extension
   ```
5. 确认后，扩展管理页即可看到 **「超星学习通全自动答题助手」**，并在浏览器工具栏中显示插件图标。

---

## 🛠️ 使用说明

1. **配置大模型 API**：
   - 点击浏览器右上角插件图标打开控制面板。
   - **API Base URL**：填入你的 API 地址（如 `https://api.openai.com/v1` 或各类中转接口）。
   - **API Key**：填入你的 API 密钥（支持点击眼睛图标切换显示/掩码）。
   - **模型名称 (Model)**：默认预置为 `Agnes-3.0-flash`，也可自由选择或手动输入 `gemini-2.5-flash`、`gpt-4o`、`deepseek-chat` 等。
   - 点击 **「测试连接」** 按钮，验证网络与模型响应是否正常。
2. **进入作业页面**：
   - 在 Edge 浏览器中登录超星学习通并进入作业/测验作答页（如 `.../mooc2/work/dowork?...`）。
   - 插件弹窗顶部的状态指示灯将自动由灰色转为绿色，提示 **「已识别 X 道题」**。
3. **开始全自动答题**：
   - 点击主界面的 **「开始自动答题」** 按钮。
   - 插件将自动执行：
     1. 从页面 DOM 中完整抽取题干、题型与选项；
     2. 将题目打包发送至后台 Service Worker，由大模型进行高准确度推理并解析结构化 JSON 答案；
     3. 逐题进行拟真鼠标点击与键盘录入，同时页面右上角将显示实时作答进度条；
     4. 作答完毕后，自动执行「暂时保存」→ 等待 2 秒 → 点击「提交」→ 确认二次弹窗 → **立即终止任务**，显示「已提交完成」。

---

## 📂 插件目录结构

```text
chaoxing-edge-extension/
├── manifest.json            # Manifest V3 核心清单文件（权限、内容脚本配置）
├── README.md                # 插件使用文档与说明
├── icons/                   # 插件多尺寸高清图标 (16x16, 48x48, 128x128)
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── popup/                   # 插件弹出控制面板
│   ├── popup.html           # 现代化配置与控制台布局
│   ├── popup.css            # 紧凑暗色风格美化样式
│   └── popup.js             # API 配置管理、状态监听、任务调度
├── background/              # 后台服务脚本
│   └── background.js        # Service Worker：大模型 API 请求代理、CSP 绕过、任务中继
└── content/                 # 页面注入脚本
    ├── content.js           # 题目解析抽取、拟真键鼠事件派发、提交流程执行
    ├── content.css          # 页面浮动进度条与高亮样式
    └── page_inject.js       # 主世界注入脚本：与 UEditor 实例和学习通全局函数通信
```
