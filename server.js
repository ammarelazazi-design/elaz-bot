const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require("fs");
const path = require("path");

const app = express().use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// تحميل الخدمات
let products = {};
const productsPath = path.join(__dirname, "products.json");

function loadProducts() {
  try {
    const data = fs.readFileSync(productsPath, "utf8");
    products = JSON.parse(data);
    console.log("✅ services loaded");
  } catch (err) {
    console.error("❌ error loading products");
  }
}
loadProducts();

// Webhook Verification
app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
    res.status(200).send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

// 🧠 fallback لو Gemini وقع
function fallbackReply() {
  return `أهلاً بيك 👋

نقدر نساعدك في الخدمات دي:

1️⃣ Graphic Design (لوجو وهوية بصرية)
2️⃣ Media Buying (إعلانات ممولة)
3️⃣ AI Automation (بوتات وأتمتة)
4️⃣ Web Development (قريباً)

قولّي عايز أنهي خدمة وأنا أساعدك 👌`;
}

// 🤖 Gemini مع Retry + Fallback
async function askGemini(prompt, retries = 3) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

    const response = await axios.post(url, {
      contents: [{ parts: [{ text: prompt }] }]
    });

    return response.data.candidates?.[0]?.content?.parts?.[0]?.text || fallbackReply();

  } catch (error) {
    if (retries > 0) {
      console.log("🔄 إعادة المحاولة...");
      await new Promise(r => setTimeout(r, 1000));
      return await askGemini(prompt, retries - 1);
    }

    console.log("❌ Gemini فشل، استخدام fallback");
    return fallbackReply();
  }
}

// استقبال الرسائل
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
          // تجهيز الخدمات من JSON
          const productsText = Object.keys(products)
            .map(key => {
              const p = products[key];
              return `${key} - ${p.name} - ${p.price} - ${p.description}`;
            })
            .join("\n");

          const prompt = `
أنت موظف مبيعات في شركة "إيلاز".

الخدمات:
${productsText}

قواعد:
- اتكلم فقط عن الخدمات
- ساعد العميل يفهم ويختار
- اقترح أفضل خدمة حسب كلامه
- لا تخترع خدمات
- لو السؤال خارج الشغل قول:
"آسف، أقدر أساعدك بس في خدمات إيلاز."

سؤال العميل:
${userMessage}
`;

          const aiResponse = await askGemini(prompt);
          await callSendAPI(sender_psid, aiResponse);

        } catch (error) {
          await callSendAPI(sender_psid, "❌ حصل خطأ، حاول تاني");
        }
      }
    }
  }
});

// إرسال رسالة
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
    console.error("FB ERROR");
  }
}

// تشغيل السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 البوت شغال"));
