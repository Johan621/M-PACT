import { useState, useRef } from 'react';
import axios from 'axios';

export default function App() {
  const [messages, setMessages] = useState([{ role: 'agent', text: 'Welcome to M-PACT. What are you looking for today?' }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  
  const sessionId = useRef('sess_' + Math.random().toString(36).substring(2, 9)).current;

  const handlePayment = (checkoutData) => {
    const options = {
      key: checkoutData.razorpay_key_id,
      amount: checkoutData.amount,
      currency: checkoutData.currency,
      name: "M-PACT Commerce",
      description: "Negotiated Purchase",
      order_id: checkoutData.order_id,
      handler: async function (response) {
        try {
          // 1. Verify the signature on the backend
          const verifyRes = await axios.post("http://localhost:5000/api/payments/verify", {
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature
          });

          if (verifyRes.data.status === "verified" || verifyRes.data.payment_status === "verified") {
            // 2. Push an explicit success message to the chat state
            setMessages(prev => [
              ...prev,
              { 
                role: "agent", 
                text: `✅ Payment verified successfully by backend!\n- **Order ID:** ${response.razorpay_order_id}\n- **Payment ID:** ${response.razorpay_payment_id}\n- **Status:** Completed & Secured 🎉` 
              }
            ]);
          }
        } catch (err) {
          setMessages(prev => [
            ...prev,
            { role: "agent", text: "❌ Payment verification failed on the server." }
          ]);
        }
      },
      theme: { color: "#3399cc" }
    };
    const rzp = new window.Razorpay(options);
    rzp.open();
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMsg = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setLoading(true);

    try {
      const res = await axios.post('https://m-pact.onrender.com', { 
        message: userMsg,
        sessionId: sessionId,
        session_id: sessionId 
      });
      
      setMessages(prev => [...prev, { role: 'agent', text: res.data.message }]);
      
      if (res.data.checkout) {
         handlePayment(res.data.checkout);
      }
    } catch (error) {
      setMessages(prev => [...prev, { role: 'agent', text: '⚠️ Connection failed.' }]);
    }
    setLoading(false);
  };

  return (
    <div style={{ maxWidth: '600px', margin: '40px auto', fontFamily: 'system-ui, sans-serif' }}>
      <h2 style={{ textAlign: 'center' }}>M-PACT AI Agent</h2>
      <div style={{ height: '400px', overflowY: 'auto', border: '1px solid #ccc', padding: '20px', borderRadius: '8px', marginBottom: '20px', backgroundColor: '#f9f9f9' }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ textAlign: msg.role === 'user' ? 'right' : 'left', margin: '10px 0' }}>
            <span style={{ display: 'inline-block', padding: '10px 15px', borderRadius: '20px', backgroundColor: msg.role === 'user' ? '#007bff' : '#e9ecef', color: msg.role === 'user' ? '#fff' : '#000' }}>
              {msg.text}
            </span>
          </div>
        ))}
        {loading && <div style={{ textAlign: 'left', color: '#666' }}>Agent is thinking...</div>}
      </div>
      <form onSubmit={sendMessage} style={{ display: 'flex', gap: '10px' }}>
        <input type="text" value={input} onChange={(e) => setInput(e.target.value)} style={{ flex: 1, padding: '12px', borderRadius: '4px', border: '1px solid #ccc' }} />
        <button type="submit" style={{ padding: '12px 24px', backgroundColor: '#28a745', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Send</button>
      </form>
    </div>
  );
}