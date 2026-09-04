const OpenAI = require("openai");
const { AGENT_SYSTEM_PROMPT } = require("./agentPrompt");
const { tools } = require("./tools");
const { searchCatalog, getProduct, getMerchantPolicy } = require("../services/policyService");
const { getSession, submitOffer, acceptOffer } = require("../services/negotiationService");
const { createCheckout } = require("../services/checkoutService");

let client = null;

function getClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!client) {
    client = new OpenAI({ 
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
    });
  }
  return client;
}

async function executeTool(name, args, sessionId) {
  const session = getSession(sessionId || "default_session");
  const lastOfferId = session.offer_ids?.length ? session.offer_ids[session.offer_ids.length - 1] : null;

  // Bulletproof: Auto-inject the latest offer ID if the AI forgets it
  if ((name === "accept_offer" || name === "create_checkout") && !args.offer_id) {
     args.offer_id = lastOfferId;
  }

  switch (name) {
    case "search_catalog": return searchCatalog(args);
    case "get_product": {
      const product = getProduct(args.product_id);
      return product ? product : { status: "error", reason: "PRODUCT_NOT_FOUND" };
    }
    case "get_merchant_policy": return getMerchantPolicy();
    case "submit_offer": return submitOffer({ ...args, sessionId });
    case "accept_offer": return acceptOffer({ ...args, sessionId });
    case "create_checkout": return await createCheckout({ ...args, sessionId });
    default: return { status: "error", reason: "UNKNOWN_TOOL" };
  }
}

async function runAgent({ message, sessionId }) {
  const openai = getClient();
  const session = getSession(sessionId || "default_session");

  if (!openai) return { message: "OpenAI not configured.", mode: "demo" };

  let latestCheckout = null;

  if (!session.history) {
    session.history = [{ role: "system", content: AGENT_SYSTEM_PROMPT }];
  }

  session.history.push({ role: "user", content: message });

  // Deterministic fallback: if buyer says accept, finalize and checkout immediately
  if (/accept/i.test(message) && session.offer_ids?.length) {
    const lastOfferId = session.offer_ids[session.offer_ids.length - 1];
    acceptOffer({ sessionId: session.session_id, offer_id: lastOfferId });
    const checkout = await createCheckout({ sessionId: session.session_id, offer_id: lastOfferId });
    return {
      message: `Offer authorized and accepted! Opening Razorpay checkout for ₹${checkout.amount / 100}...`,
      checkout,
      mode: "deterministic"
    };
  }
  for (let step = 0; step < 6; step += 1) {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "openrouter/free",
      messages: session.history,
      tools,
      // tool_choice: "auto",
      temperature: 0.2
    });

    const assistantMessage = response.choices?.[0]?.message;
    if (!assistantMessage) return { message: "The AI agent returned no response." };

    session.history.push(assistantMessage);

    if (!assistantMessage.tool_calls?.length) {
      return {
        message: assistantMessage.content || "I could not produce a response.",
        checkout: latestCheckout,
        mode: "ai"
      };
    }

    for (const toolCall of assistantMessage.tool_calls) {
      let args = {};
      try {
        args = JSON.parse(toolCall.function.arguments || "{}");
      } catch { /* ignore parse errors */ }

      const result = await executeTool(toolCall.function.name, args, session.session_id);

      if (result && (result.status === "checkout_created" || result.order_id)) {
        latestCheckout = result;
      }

      session.history.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result)
      });
    }
  }

  return { message: "I checked the catalog, but could not finalize the request.", checkout: latestCheckout, mode: "ai" };
}

module.exports = { runAgent };