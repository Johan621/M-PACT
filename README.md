# M-PACT: AI Agentic Commerce

M-PACT makes any merchant understandable, negotiable, and transactable by an AI buyer end-to-end. Built for Track 01 of the Razorpay Buildathon.

**Core Architecture:**
* **Frontend:** React (`App.jsx`) with centralized session management.
* **Backend:** Node/Express (`server.js`) featuring a deterministic policy engine.
* **AI:** Google Gemini 1.5 Flash (via OpenRouter) / Llama 3.1.
* **Payments:** Razorpay Test Mode with server-side HMAC-SHA256 verification.

**How to Run Locally:**
1. Clone the repository.
2. In `/backend`, copy `.env.example` to `.env` and add your keys:
   `OPENAI_API_KEY=your_key`
   `RAZORPAY_KEY_ID=rzp_test_...`
   `RAZORPAY_KEY_SECRET=your_secret`
3. Run `npm install` and `npm start` in the backend.
4. Run `npm install` and `npm run dev` in the `/frontend` directory.

**What Broke at 2 AM & How We Escaped:**
1. **Context Amnesia:** The LLM kept forgetting the `offer_id` required to trigger the checkout tool. *Fix:* We bypassed the LLM's weak memory by implementing a deterministic auto-injector in the backend that catches the word "accept" and forcefully binds the active session's offer ID to the Razorpay checkout creator.
2. **The OFFER_SESSION_MISMATCH:** The AI frontend was generating a new `session_id` every message, causing the policy engine to reject valid offers because it thought a different buyer was trying to claim them. *Fix:* We unified the payload to send both `sessionId` and `session_id`, and forced React to persist a single `useRef` session string across the entire component lifecycle.