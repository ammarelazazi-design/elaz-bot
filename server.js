const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require("fs");
const path = require("path");

const app = express().use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// 1. تحميل الخدمات من ملف products.json
let products = {};
const productsPath = path.join(__dirname, "products.json");

function loadProducts() {
  try {
    if (fs.existsSync(productsPath)) {
      const data = fs.readFileSync(productsPath, "utf8");
      products = JSON.parse(data);
      console.log("✅ Services loaded successfully");
    } else {
      console.error("❌ products.json not found!");
    }
  } catch (err) {
    console.error("❌ Error parsing products.json:", err.message);
  }
}
loadProducts();

// 2. الرد الاحتياطي في حال فشل Gemini
function fallbackReply() {
  return `أهلاً بك في وكالة ELAZ 👋

نعتذر عن التأخير البسيط، هذه هي خدماتنا المتاحة حالياً:

1️⃣ Graphic Design (هوية بصرية ولوجو)
2️⃣ Media Buying (إعلانات ممولة)
3️⃣ AI Automation (بوتات ذكية)
4️⃣ Web Development (قريباً)

أخبرنا بالخدمة التي تهمك وسيقوم أحد ممثلينا بالتواصل معك 👌`;
}

// 3. دالة التواصل مع Gemini (مع Retry و Detailed Logging)
async function askGemini(prompt, retries = 3) {
  try {
    // استخدمنا v1beta وموديل flash-latest لأنه الأضمن
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

    const response = await axios.post(url, {
      contents: [{ parts: [{ text: prompt }] }]
    }, { timeout: 10000 });

    return response.data.candidates?.[0]?.content?.parts?.[0]?.text || fallbackReply();

  } catch (error) {
    // طباعة تفاصيل الخطأ في Render Logs
    if (error.response) {
      console.error("❌ Gemini API Error Details:", JSON.stringify(error.response.data));
    } else {
      console.error("❌ Connection Error:", error.message);
    }

    if (retries > 0) {
      console.log(`🔄 Retrying... (${3 - retries + 1})`);
      await new Promise(r => setTimeout(r, 1500));
      return await askGemini(prompt, retries - 1);
    }

    console.log("⚠️ All retries failed, using fallback.");
    return fallbackReply();
  }
}

// 4. Webhook Verification
app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
    res.status(200).send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

// 5. استقبال الرسائل
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    res.status(200).send('EVENT_RECEIVED');

    for (const entry of body.entry) {
      const event = entry.messaging?.[0];

      if (event && event.message && !event.message.is_echo && event.message.text) {
        const sender_psid = event.sender.id;
        const userMessage = event.message.text;

        try {
          const servicesContext = JSON.stringify(products, null, 2);
          const prompt = `أنت موظف مبيعات ذكي في شركة "إيلاز" (ELAZ).
          الخدمات المتاحة: ${servicesContext}
          
          القواعد:
          - رد بلهجة مصرية احترافية وودودة.
          - لا تقترح خدمات خارج القائمة.
          - إذا سألك عن شيء غير موجود، اعتذر بذوق ووجهه لخدمات إيلاز.
          
          رسالة العميل: ${userMessage}`;

          const aiResponse = await askGemini(prompt);
          await callSendAPI(sender_psid, aiResponse);

        } catch (error) {
          console.error("Post Processing Error:", error.message);
        }
      }
    }
  }
});

// 6. إرسال الرسالة لفيسبوك
async function callSendAPI(sender_psid, responseText) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        recipient: { id: sender_psid },
        message: { text: responseText }
      }
    );
  } catch (err) {
    console.error("❌ FB Send Error");
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 ELAZ Bot is up and running!"));
