# M-PACT: AI Agentic Commerce

M-PACT is an autonomous AI commerce agent built for Track 01 of the Razorpay Buildathon. It transforms a standard merchant catalog into a conversational, transactable experience where buyers can discover products, negotiate prices naturally, and securely check out.

Crucially, M-PACT does not blindly trust the LLM. It relies on a deterministic backend policy engine to strictly bound AI pricing power and cryptographically verify all payments.

### System Architecture
* **Frontend:** React (Vite) with centralized, persistent session management.
* **Backend:** Node.js & Express API routing.
* **AI Layer:** Llama 3.1 / Gemini 1.5 Flash strictly mapped to JSON tool calls.
* **Payment Gateway:** Razorpay Test API with server-side HMAC-SHA256 signature verification.

### Core Features
* **Semantic Catalog Discovery:** The agent parses natural language intent to query and return specific merchant inventory in real-time.
* **Deterministic Negotiation Guardrails:** Users can counteroffer, but the backend policy engine intercepts all requests, strictly capping discounts at 10% to protect merchant margins. AI hallucinations cannot bypass this check.
* **Cryptographically Secured Checkout:** Payments are not trusted via client-side success screens. The backend generates a secure Razorpay Order ID and verifies the `razorpay_signature` post-payment to prevent client-side spoofing.
* **Deterministic Fallback Execution:** If the LLM suffers from context amnesia and fails to call the checkout tool, a backend auto-injector detects acceptance intents and forcefully binds the active session's offer ID to the checkout creator to prevent the flow from breaking.

### How to Run Locally
1. Clone the repository.
2. In `/backend`, duplicate `.env.example` to `.env` and configure:
   `OPENAI_API_KEY=your_key`
   `RAZORPAY_KEY_ID=rzp_test_your_key`
   `RAZORPAY_KEY_SECRET=your_secret`
3. Start Backend: `cd backend && npm install && npm start`
4. Start Frontend: `cd frontend && npm install && npm run dev`

### The Biggest Engineering Challenge
Our toughest hurdle was an `OFFER_SESSION_MISMATCH` rejection occurring right at the point of checkout. The React frontend was inadvertently generating a new session ID on every single chat message re-render. The backend policy engine correctly blocked the checkout because it perceived a completely different buyer attempting to claim an active offer. 

We resolved this by unifying the payload keys across Express and React, and utilizing React's `useRef` hook to persist a single, immutable session string across the entire component lifecycle.