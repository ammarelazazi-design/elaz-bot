const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require("fs");
const path = require("path");

const app = express().use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// 1. تحميل الخدمات من ملف products.json
let products = {};
const productsPath = path.join(__dirname, "products.json");

function loadProducts() {
  try {
    if (fs.existsSync(productsPath)) {
      const data = fs.readFileSync(productsPath, "utf8");
      products = JSON.parse(data);
      console.log("✅ Services loaded successfully");
    }
  } catch (err) {
    console.error("❌ Error loading products.json");
  }
}
loadProducts();

// 2. الرد الاحتياطي (Fallback) - هيظهر فقط لو الـ API مفصل
function fallbackReply() {
  return `أهلاً بك في وكالة ELAZ 👋
نعتذر عن التأخير، إليك خدماتنا:
1️⃣ تصميم جرافيك
2️⃣ إعلانات ممولة
3️⃣ أتمتة الذكاء الاصطناعي
4️⃣ تطوير مواقع
قولنا محتاج إيه وهنتواصل معاك فوراً!`;
}

// 3. دالة الذكاء الاصطناعي باستخدام Groq (الموديل الأقوى llama-3.3-70b)
async function askAI(prompt, retries = 2) {
  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile", // الموديل ده جبار في فهم الكلام المكسر واللغات
        messages: [{ role: "user", content: prompt }],
        temperature: 0.8 // زيادة الحرارة شوية عشان يكون مرن في فهم الأخطاء الإملائية
      },
      {
        headers: {
          "Authorization": `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 10000
      }
    );

    return response.data.choices[0]?.message?.content || fallbackReply();
  } catch (error) {
    // طباعة الخطأ بالتفصيل عشان نعرف العيب فين لو الـ AI ما ردش
    console.error("❌ Groq Error Details:", error.response?.data || error.message);
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 1000));
      return await askAI(prompt, retries - 1);
    }
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
      if (event?.message?.text && !event.message.is_echo) {
        const sender_psid = event.sender.id;
        const userMessage = event.message.text;

        try {
          const servicesContext = JSON.stringify(products);
          const prompt = `أنت موظف مبيعات ذكي جداً في وكالة "ELAZ" لخدمات الديجيتال.
          خدماتنا هي: ${servicesContext}
          
          إرشادات الرد:
          - رد بلهجة مصرية عامية "ودودة جداً" ومحترفة.
          - أنت عبقري في فهم العميل حتى لو كتب كلمات غلط (مثلاً لو قال عسان يقصد عشان، لو قال لوحو يقصد لوجو).
          - افهم أي لغة يكتب بها العميل ورد عليه بنفس المستوى.
          - هدفك تشرح الخدمات اللي في الملف وتقنع العميل بينا.
          
          رسالة العميل: ${userMessage}`;

          const aiResponse = await askAI(prompt);
          await callSendAPI(sender_psid, aiResponse);
        } catch (error) {
          console.error("Processing Error");
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
app.listen(PORT, () => console.log("🚀 ELAZ Bot is Live with Llama 3.3!"));
