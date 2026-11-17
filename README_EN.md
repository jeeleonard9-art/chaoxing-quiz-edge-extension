# Chaoxing Quiz Auto Assistant (Microsoft Edge Extension)

[English Documentation](README_EN.md) | [中文文档](README.md)

An automated quiz-answering browser extension for **Chaoxing MOOC (超星学习通)**, built upon the **Manifest V3** standard. It seamlessly migrates and elevates core DOM parsing and simulation strategies, providing a full-loop workflow: question structure extraction, LLM API inference, human-like mouse/keyboard interactions, draft saving, and auto-submission with immediate termination.

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
