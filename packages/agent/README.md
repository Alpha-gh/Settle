# @settle/agent (System 3)

The autonomous accounts-receivable and cash-flow intelligence system for **Settle** (PayPal AI Hackathon).

---

## 1. Purpose & Design Principles

`@settle/agent` implements the `AgentPort` interface to provide autonomous decision-making and conversational assistance for small business accounts receivable:
1. **Never touches PayPal directly**: All actions are evaluated through local policy and submitted as approved/awaiting records for System 1 to execute.
2. **Never does manual arithmetic**: Every number, balance, shortfall, and delta comes from `EnginePort` simulation.
3. **Strict Grounding Guarantee**: The LLM chooses among code-generated option IDs and writes explanations; every number and date is verified against engine facts.
4. **Deterministic Fallbacks**: If an LLM call fails, times out, or produces ungrounded tokens, the system gracefully falls back to deterministic decision logic without halting.
5. **Strict Money & Date Representation**: All monetary values are integer cents USD (`Cents = number`). All dates are ISO-8601 `YYYY-MM-DD`. `new Date()` is strictly isolated to `src/clock.ts`.

---

## 2. Architecture

```
                  ┌───────────────────────────────┐
                  │    System 1: Host Orchestrator │
                  └───────────────┬───────────────┘
                                  │ runCycle(snapshot) / chat(q, snapshot)
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ @settle/agent                                                                   │
│                                                                                 │
│   ┌───────────────────────────┐          ┌───────────────────────────────────┐  │
│   │ runCycle Pipeline         │          │ chat Pipeline                     │  │
│   │  1. Scan overdue invoices │          │  1. Check scope & reject off-topic│  │
│   │  2. Simulate options      │          │  2. Provide 14-day calendar table │  │
│   │  3. LLM decision + retry  │          │  3. runWithTools (maxSteps: 4)    │  │
│   │  4. Grounding verification│          │  4. Tool results grounding check  │  │
│   │  5. Draft note generation │          │  5. Retry once / fallback template│  │
│   │  6. evaluatePolicy        │          └───────────────────────────────────┘  │
│   │  7. State fold simulation │                                                 │
│   └─────────────┬─────────────┘                                                 │
└─────────────────┼───────────────────────────────────┼───────────────────────────┘
                  │                                   │
                  ▼                                   ▼
        ┌───────────────────┐               ┌───────────────────┐
        │    EnginePort     │               │      LlmPort      │
        │ (forecast/simulate│               │ (mock, gemini,    │
        │  generateOptions) │               │  anthropic, openai│
        └───────────────────┘               └───────────────────┘
```

---

## 3. Environment Variables

| Variable | Description | Default | Allowed Values |
| :--- | :--- | :--- | :--- |
| `LLM_PROVIDER` | Active LLM adapter provider | `mock` | `mock`, `gemini`, `anthropic`, `openai` |
| `LLM_TIMEOUT_MS` | Request timeout in milliseconds | `15000` | Any integer $> 0$ |
| `GEMINI_API_KEY` | Google Gemini API Key | *(unset)* | String |
| `GEMINI_MODEL` | Gemini model name | `gemini-1.5-flash` | Valid Gemini model ID |
| `ANTHROPIC_API_KEY`| Anthropic Claude API Key | *(unset)* | String |
| `ANTHROPIC_MODEL` | Anthropic model name | `claude-3-5-sonnet-20241022` | Valid Claude model ID |
| `OPENAI_API_KEY` | OpenAI API Key | *(unset)* | String |
| `OPENAI_MODEL` | OpenAI model name | `gpt-4o-mini` | Valid OpenAI model ID |

> **Note**: Always confirm current model IDs in the respective provider's official documentation.

---

## 4. Provider Setup

Create a `.env` file in `packages/agent/.env` (or root `.env`):

```bash
# Mock (default, zero keys required)
LLM_PROVIDER=mock

# Google Gemini
LLM_PROVIDER=gemini
GEMINI_API_KEY=AIzaSy...
GEMINI_MODEL=gemini-1.5-flash

# Anthropic Claude
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022

# OpenAI
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

---

## 5. Running Scripts and Tests

All scripts run out-of-the-box in Windows PowerShell and Unix shells:

```powershell
# Run all unit and integration tests
pnpm -F @settle/agent test

# Run TypeScript typecheck
pnpm -F @settle/agent typecheck

# Build the package
pnpm -F @settle/agent build

# Run autonomous AR cycle demo (Mock LLM + Fake Engine)
pnpm -F @settle/agent exec tsx scripts/demoCycle.ts

# Run interactive chat demo
pnpm -F @settle/agent exec tsx scripts/chatDemo.ts

# Run 20-snapshot evaluation suite
pnpm -F @settle/agent exec tsx scripts/eval.ts --provider mock

# Run real provider evaluation (requires API key in .env)
pnpm -F @settle/agent exec tsx scripts/eval.ts --provider gemini

# Run live provider smoke test (skips safely if no key configured)
pnpm -F @settle/agent exec tsx scripts/liveSmoke.ts
```

---

## 6. Prompt Text Locations

- **Decision Prompt**: [`src/prompts/decision.ts`](src/prompts/decision.ts)
  - Constructs system prompt with optimization guidelines and user prompt presenting options with exact engine simulation facts.
- **Customer Note Drafting Prompt**: [`src/draftNote.ts`](src/draftNote.ts)
  - Instructs model to compose polite, actionable notes adhering to 500-char limits, exact `{{PAY_URL}}` token, and strict grounding facts.
- **Chat System Prompt**: [`src/chat/chat.ts`](src/chat/chat.ts)
  - Defines the scope boundary, injects current `asOf` date and dynamically generated 14-day calendar table.

---

## 7. AI Attribution Note for Devpost

- **Decision-Making**:
  - LLM models (`gemini-1.5-flash`, `claude-3-5-sonnet-20241022`, `gpt-4o-mini`, or `MockLlm`) make contextual judgment calls: selecting between discount, reminder, or instalment options based on debtor profile and cash impact, and generating personalized debtor communications.
- **Mathematical Integrity**:
  - All numerical predictions (lowest cash balances, shortfall estimates, recovery percentages, and calendar dates) originate **exclusively from the deterministic forecasting engine (`EnginePort`)**.
  - The agent employs a bidirectional grounding check to verify that no LLM hallucination can alter monetary balances or due dates.

