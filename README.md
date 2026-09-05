# TRIBUNAL — Think it through.

> **A compact, multi-model AI routing showcase for multi-perspective debate and synthesis.**

**TRIBUNAL** is a lightweight, high-performance web application built to help users examine complex, contested questions from every angle. Instead of relying on a single AI response, TRIBUNAL convenes three distinct minds—an **Advocate**, a **Critic**, and an **Auditor**—before a **Judge** synthesizes their arguments into a calibrated verdict.

---

## 🌟 Key Features

* **3-Stage Analytical Pipeline**:
  1. **Advocate**: Steelmans the argument **FOR** the proposition.
  2. **Critic**: Mounts the strongest case **AGAINST** the proposition.
  3. **Auditor**: Cross-checks both sides for factual accuracy, logical consistency, and overreach.
  4. **Judge**: Synthesizes all perspectives into a clear summary, key takeaways, and a confidence-scored verdict.
* **Smart Intake Triage**: Automatically classifies user queries (small talk, meta questions, or debate topics) and reframes messy input into neutral propositions before spawning agents.
* **Multi-Model Provider Routing**: Routes requests dynamically across **Groq**, **NVIDIA NIM**, and **Google Gemini** with automatic rate-limit and missing-key failovers.
* **Bring Your Own Key (BYOK)**: Supports user-supplied Gemini API keys stored locally in the browser (`localStorage`) without server-side storage or logging.
* **Streaming NDJSON Architecture**: Uses HTTP streaming (NDJSON) to stream partial agent chunks in real time.
* **Privacy & Security First**: Automatic redaction of API keys, bearer tokens, and auth headers from all log output.
* **Lightweight UI & Themes**: Built with Next.js 16 (App Router), Tailwind CSS, Framer Motion, dark/light modes, responsive layout, and desktop sidebar toggling.

---

## 🛠️ Tech Stack

* **Framework**: [Next.js 16](https://nextjs.org/) (App Router & React Server Components / Client Components)
* **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) & CSS variables
* **Animations**: [Framer Motion](https://www.framer.com/motion/)
* **Icons**: [Lucide React](https://lucide.dev/)
* **AI SDKs**: [`@google/genai`](https://www.npmjs.com/package/@google/genai) & OpenAI-compatible Chat Completions API (Groq / NVIDIA NIM)
* **Package Manager**: [pnpm](https://pnpm.io/)

---

## ⚙️ Multi-Model AI Routing

TRIBUNAL routes each stage of the debate pipeline to a specialized provider for optimal performance and diversity of perspective:

| Stage | Default Provider | Model / Endpoint |
| :--- | :--- | :--- |
| **Intake Triage** | Groq | `openai/gpt-oss-120b` |
| **Advocate (FOR)** | Groq | `openai/gpt-oss-120b` |
| **Critic (AGAINST)** | NVIDIA NIM | `nvidia/nemotron-3-super-120b-a12b` |
| **Auditor** | Groq | `openai/gpt-oss-120b` |
| **Judge** | Gemini | `gemini-3.6-flash` |

*Note: In **BYOK Mode**, all stages use the user's supplied Gemini key.*

---

## 🚀 Getting Started

### Prerequisites

* Node.js 18+ or 20+
* pnpm (`npm i -g pnpm`)

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/lavanHarsha/tribunal_ai



cd tribunal
pnpm install
2. Configure Environment Variables
Create a .env.local file in the root directory:

# Server Provider Keys (Configure at least one or rely on client BYOK)
GROQ_API_KEY=gsk_...
NVIDIA_API_KEY=nvapi-...
GEMINI_API_KEY=AIzaSy...

# Optional Model Overrides
GEMINI_MODEL=gemini-3.6-flash
GROQ_MODEL=openai/gpt-oss-120b
NVIDIA_MODEL=nvidia/nemotron-3-super-120b-a12b
3. Run Development Server
pnpm run dev
Open http://localhost:3000 in your browser.

🧪 Verification & Build Commands
Type Check:
pnpm exec tsc --noEmit
Production Build:
pnpm run build
Start Production Server:
pnpm run start
📁 Repository Structure
.
├── app/
│   ├── api/
│   │   └── debate/        # NDJSON streaming endpoints (/api/debate & /api/debate/agent)
│   ├── globals.css        # Minimal CSS variables, themes, & utility overrides
│   ├── layout.tsx         # Root layout with editorial font configuration
│   └── page.tsx           # Main workspace UI & client state manager
├── lib/
│   ├── ai/
│   │   ├── agents.ts      # Agent definitions & system instructions
│   │   ├── config.ts      # Model tokens, temperatures, & env configs
│   │   ├── debate.ts      # Pipeline orchestration logic
│   │   ├── judge.ts       # Structured JSON verdict generation & sanitization
│   │   ├── provider.ts    # Multi-provider router, streaming, & key masking
│   │   ├── triage.ts      # Local & model intake query classifier
│   │   └── validate.ts    # Request payload sanitization
│   ├── byok.ts            # Client-side BYOK localStorage manager
│   ├── history.ts         # LocalStorage history persistence
│   ├── prefs.ts           # Theme & sidebar state storage
│   └── utils.ts           # Classnames helper
└── package.json
