# Chaoxing Quiz Auto Assistant (Microsoft Edge Extension)

[English Documentation](README_EN.md) | [中文文档](README.md)

An automated quiz-answering browser extension for **Chaoxing MOOC (超星学习通)**, built upon the **Manifest V3** standard (Version: **v1.0.1**). It seamlessly migrates and elevates core DOM parsing and simulation strategies, providing a full-loop workflow: question structure extraction, LLM API inference, human-like mouse/keyboard interactions, draft saving, and auto-submission with immediate termination.

---

## ⚡ Quick Download & Installation

> [!TIP]
> ### 📦 Direct Download Links (Ready to use)
> - 🚀 **[Download Latest Extension Package (.zip) - v1.0.1](https://github.com/jeeleonard9-art/chaoxing-quiz-edge-extension/releases/download/v1.0.1/chaoxing-quiz-edge-extension-v1.0.1.zip)** (Recommended: Unzip and load directly into Edge)
> - 🏷️ **[View All Releases on GitHub](https://github.com/jeeleonard9-art/chaoxing-quiz-edge-extension/releases)**
> - 📂 **[Download Source Code Archive (main.zip)](https://github.com/jeeleonard9-art/chaoxing-quiz-edge-extension/archive/refs/heads/main.zip)**

### 🧩 Notice on `edge://extensions/` Links & 3-Step Setup
> [!NOTE]
> Due to the security sandbox enforced by Chromium and Microsoft Edge, external web pages (including GitHub) are **strictly forbidden from opening internal privileged protocols like `edge://` or `chrome://`** via regular web links to prevent malicious script execution or silent extension alterations.
>
> **Fast 3-Step Setup**:
> 1. Download the **[v1.0.1 ZIP Package](https://github.com/jeeleonard9-art/chaoxing-quiz-edge-extension/releases/download/v1.0.1/chaoxing-quiz-edge-extension-v1.0.1.zip)** above and extract it to any folder.
> 2. Open Microsoft Edge, copy and paste this address into the URL bar and press Enter:
>    ```text
>    edge://extensions/
>    ```
> 3. Toggle on **"Developer mode"** in the sidebar/top, click **"Load unpacked"**, and select the extracted extension folder!
>
> *(Note: If this extension is published to the [Microsoft Edge Add-ons Store](https://microsoftedge.microsoft.com/addons), direct web link installation will be supported.)*

---

## 🚀 v1.0.1 Architecture Fixes & Stability Changelog

- **[P0] Fixed Multi-Frame Racing & Frame Isolation (TASK-01)**: Disabled `match_about_blank`; frames without quiz DOM remain completely silent. Service worker identifies target quiz frame via `scripting.executeScript` and binds communications to `frameId`.
- **[P0] Frame-Self Injections with Bridge Token & Whitelist (TASK-02 & TASK-08)**: Removed cross-frame delegation. Each quiz frame injects `page_inject.js` directly into its own context with a random `BRIDGE_TOKEN` handshake. Global page method calls are strictly whitelist-gated.
- **[P0] Symmetric Difference Choice Clicking (TASK-03)**: Redesigned choice selection into symmetric state difference flipping. Eliminates accidental unchecking of multi-choice options upon retry or pre-existing answers.
- **[P1] Instant Task Abort & 60s Request Timeout (TASK-04 & TASK-05)**: Implemented missing `STOP_TASK` in background service worker using `AbortController` to immediately cancel in-flight API requests and prevent subsequent operations. Added a 60-second fetch timeout.
- **[P1] Batch Chunking (10 Questions/Batch) & Session Storage (TASK-05)**: Divides large question sets into chunks of 10 to avoid token limits and truncated JSON. Persists `taskState` in `chrome.storage.session` to survive MV3 Service Worker dormancy.
- **[P1] UEditor Safe HTML Entity Escaping & Paragraphs (TASK-06)**: Removed redundant letter-by-letter typing. Implemented `textToSafeHtml` to escape `<` and `>` while wrapping paragraphs in `<p>`, preserving code snippets and mathematical formulas.
- **[P2] Image/Formula Extraction & Multi-slot Splitting (TASK-07)**: Extracts images as `[公式/图片: ...]` placeholders with review warnings. Binds answers by unique string `qid`. Automatically splits merged multi-blank strings.
- **[P2] Smart API Base URL Normalization (TASK-08)**: Automatically completes root-domain URLs to `/v1/chat/completions`.

---

---

## ✨ Key Features

1. **Robust DOM Parsing & Multi-layer iframe Penetration**:
   - Deeply inspects and penetrates multi-layer `iframe` hierarchies (including chapter quizzes, courseware embedded frames, and standalone homework URLs like `mooc2/work/dowork`).
   - Supports **Single Choice, Multiple Choice, True/False, Fill-in-the-Blank, and Free-Response / Subjective** questions.
2. **Flexible LLM API Integration**:
   - Out-of-the-box support for the default preset model **`Agnes-3.0-flash`**.
   - Fully compatible with OpenAI API standards (`/v1/chat/completions`) and any custom reverse proxies (e.g. Gemini, GPT-4o, DeepSeek, Qwen).
   - All external HTTP requests are routed through the `background.js` Service Worker to bypass web page Content-Security-Policy (CSP) and CORS restrictions.
   - Built-in API connection tester to verify endpoint readiness and model responsiveness.
3. **Realistic Human-like Mouse & Keyboard Interactions**:
   - **Objective Questions (Choice / True-False)**: Smoothly scrolls to center, sequentially dispatches mouse events (`pointerover` → `mouseover` → `pointerdown` → `mousedown` → `pointerup` → `mouseup` → `click`) with natural delays (200ms–400ms), and validates platform selection state. Multi-choice questions are clicked option-by-option in ascending alphabetical order.
   - **Blanks & Subjective Questions**: Focuses inputs, triggers keystroke event chains (`keydown` → `keypress` → input → `keyup` → `change`), and bridges with the page's Main World (`page_inject.js`) to sync UEditor content with underlying serialized `<textarea>` elements (`UE.sync()`).
4. **Strict Save & Submission Workflow**:
   - **Step 1: Save Draft First**: Realistic click on "Save Draft" (暂时保存), followed by a 2-second stabilization wait.
   - **Step 2: Submit with Safeguards**: Triggers "Submit" (提交) and handles confirmation modals. If the modal indicates unanswered questions, submission is immediately intercepted for safety.
   - **Step 3: Immediate Task Termination**: As soon as submission finishes, the workflow halts completely. No page reload, redirection, or next-chapter navigation is performed.
5. **Bilingual UI (中 / EN)**:
   - Built-in one-click toggle in the popup header between Chinese and English interfaces.

---

## 🚀 Installation Guide (Microsoft Edge)

1. Open Microsoft Edge and navigate to:
   ```text
   edge://extensions/
   ```
2. In the sidebar or top bar, enable **"Developer mode"**.
3. Click the **"Load unpacked"** button.
4. Select the extension directory:
   ```text
   chaoxing-edge-extension
   ```
5. The extension **"Chaoxing Quiz Auto Assistant"** will appear in your Edge extensions list and toolbar without any Manifest or icon errors.

---

## 🛠️ Usage Instructions

1. **Configure LLM API**:
   - Click the extension icon in the browser toolbar to open the control panel.
   - Set **API Base URL** (e.g., `https://api.openai.com/v1`).
   - Paste your **API Key** (toggle mask with the eye icon).
   - Select or type the **Model Name** (default: `Agnes-3.0-flash`).
   - Click **"Test Connection"** to verify.
2. **Open the Quiz Page**:
   - Navigate to any Chaoxing quiz/assignment page (`mooc2/work/dowork?...`).
   - The status badge at the top of the popup will turn green with **"Found X questions"**.
3. **Run Automation**:
   - Click **"Start Auto-Answer"**.
   - Watch the live execution console and on-page floating status capsule as it parses questions, generates answers, simulates human keystrokes/clicks, saves draft, and safely submits!

---

## 📂 Project Structure

```text
chaoxing-edge-extension/
├── manifest.json            # Manifest V3 specification
├── README.md                # Chinese Documentation
├── README_EN.md             # English Documentation
├── _locales/                # Chrome/Edge internationalization messages
│   ├── zh_CN/messages.json
│   └── en/messages.json
├── icons/                   # High-res icons (16x16, 48x48, 128x128)
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── popup/                   # Extension popup interface
│   ├── popup.html           # Bilingual UI layout
│   ├── popup.css            # Dark Fluent-style styles
│   └── popup.js             # State synchronization and i18n handler
├── background/              # Service Worker
│   └── background.js        # LLM inference proxy & state persistence
└── content/                 # Injected content scripts
    ├── content.js           # DOM extractor, human-like interaction engine & submitter
    ├── content.css          # On-page floating status HUD & question highlighter
    └── page_inject.js       # Main World bridge for UEditor & native Chaoxing functions
```

---

## 📜 License

[MIT License](LICENSE)
