const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.json());

// الإعدادات - تأكد من إضافتها في Environment Variables على منصة الاستضافة
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "AMMAR_2026";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 📂 تحميل المنتجات من ملف JSON
let products = {};
const productsPath = path.join(__dirname, "products.json");

function loadProducts() {
  try {
    if (fs.existsSync(productsPath)) {
      const data = fs.readFileSync(productsPath, "utf8");
      products = JSON.parse(data);
      console.log(`✅ تم تحميل ${Object.keys(products).length} منتج بنجاح`);
    } else {
      console.warn("⚠️ ملف products.json غير موجود، سيتم تشغيل البوت بدون بيانات منتجات");
    }
  } catch (err) {
    console.error("❌ خطأ في قراءة ملف المنتجات:", err.message);
  }
}
loadProducts();

// 🛠️ تأكيد الـ Webhook مع فيسبوك
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ تم توثيق الـ Webhook بنجاح!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// 📩 استقبال الرسائل من فيسبوك
app.post("/webhook", (req, res) => {
  const body = req.body;

  if (body.object === "page") {
    body.entry.forEach(entry => {
      const webhookEvent = entry.messaging ? entry.messaging[0] : null;
      if (webhookEvent && webhookEvent.message && webhookEvent.message.text) {
        handleMessage(webhookEvent);
      }
    });
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

// 🤖 معالجة الذكاء الاصطناعي (عربي + إنجليزي)
async function askAI(userMessage) {
  const productList = Object.values(products)
    .map(p => `- ${p.name}: ${p.price} (${p.description || 'No description'})`)
    .join("\n");

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
            You are a professional sales assistant for "Elaz" store.
            Instruction: Always reply in the SAME language the customer uses (Arabic or English).
            
            Current Inventory:
            ${productList}

            Rules:
            1. Only promote products listed above.
            2. Be helpful and drive the customer toward making a purchase.
            3. If the user asks about anything unrelated to the store, use these replies:
               - Arabic: "آسف، أقدر أساعدك بخصوص منتجات إيلاز فقط."
               - English: "I'm sorry, I can only assist you with Elaz store products."
          `
        },
        { role: "user", content: userMessage }
      ],
      max_tokens: 200
    });
    return response.choices[0].message.content;
  } catch (error) {
    console.error("❌ OpenAI Error:", error.message);
    return "عذراً، واجهت مشكلة تقنية. حاول مرة أخرى لاحقاً.";
  }
}

// 🏗️ التعامل مع الحدث (Message Handler)
async function handleMessage(event) {
  const senderId = event.sender.id;
  const messageText = event.message.text.trim().toLowerCase();

  // 1. خيار عرض المنتجات يدوياً
  if (messageText.includes("منتجات") || messageText.includes("products")) {
    sendInventory(senderId);
    return;
  }

  // 2. معالجة الرد عبر الذكاء الاصطناعي
  const aiReply = await askAI(event.message.text);
  sendTextMessage(senderId, aiReply);
}

// 📦 إرسال قائمة المنتجات
function sendInventory(recipientId) {
  let responseText = "🛍️ قائمة منتجات إيلاز المتوفرة:\n\n";
  const keys = Object.keys(products);

  if (keys.length === 0) {
    responseText = "لا توجد منتجات متوفرة في الوقت الحالي.";
  } else {
    keys.forEach(key => {
      const p = products[key];
      responseText += • ${p.name} — السعر: ${p.price}\n;
      });
  }
  sendTextMessage(recipientId, responseText);
}

// 📤 إرسال الرسالة النهائية لفيسبوك
function sendTextMessage(recipientId, text) {
  const messageData = {
    recipient: { id: recipientId },
    message: { text: text }
  };

  fetch(`https://graph.facebook.com/v20.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(messageData)
  })
    .then(res => res.json())
    .then(json => {
      if (json.error) console.error("❌ Facebook API Error:", json.error.message);
      else console.log("✅ تم إرسال الرد بنجاح");
    })
    .catch(err => console.error("❌ Network Error:", err));
}

// 🚀 تشغيل السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Elaz Bot is running on port ${PORT}`);
});
