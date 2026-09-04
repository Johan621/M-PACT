require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const { id, sessions, offers, checkouts, webhookEvents } = require("./src/data/store");
const { runAgent } = require("./src/ai/agent");
const {
  searchCatalog,
  getProduct,
  getMerchantPolicy
} = require("./src/services/policyService");
const {
  submitOffer,
  acceptOffer,
  getOffer,
  getSession
} = require("./src/services/negotiationService");
const {
  createCheckout,
  getCheckout,
  verifyPaymentSignature,
  applyPaymentEvent,
  hasRazorpayConfig
} = require("./src/services/checkoutService");

const app = express();
const PORT = Number(process.env.PORT || 5000);

app.use(cors({
  origin: true,
  credentials: true
}));

// Razorpay requires the raw request body for webhook signature validation.
app.post(
  "/api/webhooks/razorpay",
  express.raw({ type: "application/json" }),
  (req, res) => {
    try {
      const signature = req.headers["x-razorpay-signature"];
      const eventId = req.headers["x-razorpay-event-id"];

      if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
        return res.status(503).json({
          status: "error",
          reason: "WEBHOOK_SECRET_NOT_CONFIGURED"
        });
      }

      const expected = crypto
        .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
        .update(req.body)
        .digest("hex");

      if (
        !signature ||
        expected.length !== signature.length ||
        !crypto.timingSafeEqual(
          Buffer.from(expected),
          Buffer.from(signature)
        )
      ) {
        return res.status(400).json({
          status: "error",
          reason: "INVALID_WEBHOOK_SIGNATURE"
        });
      }

      if (eventId && webhookEvents.has(eventId)) {
        return res.json({ status: "duplicate_ignored" });
      }
      if (eventId) webhookEvents.add(eventId);

      const payload = JSON.parse(req.body.toString("utf8"));
      const event = payload.event;

      const orderId =
        payload?.payload?.order?.entity?.id ||
        payload?.payload?.payment?.entity?.order_id;

      const paymentId =
        payload?.payload?.payment?.entity?.id || null;

      if (event === "order.paid" || event === "payment.captured") {
        applyPaymentEvent({
          orderId,
          paymentId,
          status: "captured",
          eventId
        });
      } else if (event === "payment.failed") {
        applyPaymentEvent({
          orderId,
          paymentId,
          status: "failed",
          eventId
        });
      }

      return res.json({ status: "processed" });
    } catch (error) {
      console.error("Webhook error:", error);
      return res.status(400).json({
        status: "error",
        reason: "INVALID_WEBHOOK_PAYLOAD"
      });
    }
  }
);

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "M-PACT",
    mission: 6,
    openai_configured: Boolean(process.env.OPENAI_API_KEY),
    razorpay_test_keys_configured: hasRazorpayConfig(),
    demo_mode: String(process.env.DEMO_MODE).toLowerCase() === "true",
    timestamp: new Date().toISOString()
  });
});

app.get("/api/catalog", (req, res) => {
  res.json({
    products: searchCatalog({
      query: req.query.q || "",
      max_price: req.query.max_price ? Number(req.query.max_price) : null,
      quantity: req.query.quantity ? Number(req.query.quantity) : null
    })
  });
});

app.get("/api/catalog/:productId", (req, res) => {
  const product = getProduct(req.params.productId);
  if (!product) return res.status(404).json({ reason: "PRODUCT_NOT_FOUND" });
  res.json(product);
});

app.get("/api/policy", (req, res) => {
  res.json(getMerchantPolicy());
});

app.post("/api/sessions", (req, res) => {
  const sessionId = id("session");
  const session = getSession(sessionId);
  res.status(201).json(session);
});

app.get("/api/sessions/:sessionId", (req, res) => {
  res.json(getSession(req.params.sessionId));
});

app.post("/api/agent/chat", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    const sessionId = String(req.body?.session_id || id("session"));

    if (!message) {
      return res.status(400).json({
        status: "error",
        reason: "MESSAGE_REQUIRED"
      });
    }

    getSession(sessionId);
    const result = await runAgent({ message, sessionId });

    res.json({
      session_id: sessionId,
      ...result,
      state: getSession(sessionId)
    });
  } catch (error) {
    console.error("Agent error:", error);
    res.status(500).json({
      status: "error",
      reason: "AGENT_ERROR",
      message: error.message
    });
  }
});

app.post("/api/offers", (req, res) => {
  const sessionId = String(req.body?.session_id || "");
  if (!sessionId) {
    return res.status(400).json({ reason: "SESSION_ID_REQUIRED" });
  }

  const result = submitOffer({
    sessionId,
    product_id: req.body?.product_id,
    quantity: req.body?.quantity,
    offered_unit_price: req.body?.offered_unit_price,
    currency: req.body?.currency || "INR"
  });

  const status = result.status === "accepted" ? 201 : 422;
  res.status(status).json(result);
});

app.get("/api/offers/:offerId", (req, res) => {
  const offer = getOffer(req.params.offerId);
  if (!offer) return res.status(404).json({ reason: "OFFER_NOT_FOUND" });
  res.json(offer);
});

app.post("/api/offers/:offerId/accept", (req, res) => {
  const sessionId = String(req.body?.session_id || "");
  if (!sessionId) {
    return res.status(400).json({ reason: "SESSION_ID_REQUIRED" });
  }

  const result = acceptOffer({
    sessionId,
    offer_id: req.params.offerId
  });

  res.status(result.status === "accepted" ? 200 : 422).json(result);
});

app.post("/api/checkout", async (req, res) => {
  try {
    const sessionId = String(req.body?.session_id || "");
    const offerId = String(req.body?.offer_id || "");

    if (!sessionId || !offerId) {
      return res.status(400).json({
        reason: "SESSION_ID_AND_OFFER_ID_REQUIRED"
      });
    }

    const result = await createCheckout({
      sessionId,
      offer_id: offerId
    });

    const status =
      result.status === "checkout_created" ? 201 :
      result.status === "rejected" ? 422 : 500;

    res.status(status).json(result);
  } catch (error) {
    console.error("Checkout error:", error);
    res.status(500).json({
      status: "error",
      reason: "CHECKOUT_ERROR",
      message: error.message
    });
  }
});

app.get("/api/checkout/:checkoutId", (req, res) => {
  const checkout = getCheckout(req.params.checkoutId);
  if (!checkout) {
    return res.status(404).json({ reason: "CHECKOUT_NOT_FOUND" });
  }
  res.json(checkout);
});

app.post("/api/payments/verify", (req, res) => {
  const result = verifyPaymentSignature({
    order_id: req.body?.razorpay_order_id,
    payment_id: req.body?.razorpay_payment_id,
    signature: req.body?.razorpay_signature
  });

  if (!result.ok) {
    return res.status(400).json(result);
  }

  const updated = applyPaymentEvent({
    orderId: req.body.razorpay_order_id,
    paymentId: req.body.razorpay_payment_id,
    status: "verified",
    eventId: `client_verify_${Date.now()}`
  });

  res.json({
    status: "verified",
    payment_status: "verified",
    ...updated
  });
});

app.get("/api/transactions/:checkoutId", (req, res) => {
  const checkout = getCheckout(req.params.checkoutId);
  if (!checkout) {
    return res.status(404).json({ reason: "CHECKOUT_NOT_FOUND" });
  }

  res.json({
    checkout_id: checkout.checkout_id,
    order_id: checkout.order_id,
    payment_id: checkout.payment_id || null,
    payment_status: checkout.payment_status,
    verified: ["verified", "captured"].includes(checkout.payment_status)
  });
});

app.get("/", (req, res) => {
  res.json({
    name: "M-PACT",
    tagline: "Make any merchant understandable, negotiable, and transactable by AI.",
    mission: 6,
    endpoints: {
      health: "GET /api/health",
      agent: "POST /api/agent/chat",
      catalog: "GET /api/catalog",
      policy: "GET /api/policy",
      sessions: "POST /api/sessions",
      offers: "POST /api/offers",
      checkout: "POST /api/checkout",
      webhook: "POST /api/webhooks/razorpay"
    }
  });
});

app.listen(PORT, () => {
  console.log(`\nM-PACT backend running on http://localhost:${PORT}`);
  console.log(`OpenAI: ${process.env.OPENAI_API_KEY ? "configured" : "not configured (demo agent mode)"}`);
  console.log(`Razorpay: ${hasRazorpayConfig() ? "configured" : "not configured (demo checkout mode)"}`);
  console.log(`Demo mode: ${process.env.DEMO_MODE}`);
});
