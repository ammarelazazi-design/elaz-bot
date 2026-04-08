const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require("fs");
const path = require("path");

const app = express().use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// 1. ذاكرة مؤقتة للمحادثات (عشان يفتكر الكلام اللي فات)
const chatHistory = {};

// 2. تحميل الخدمات من products.json
let products = {};
const productsPath = path.join(__dirname, "products.json");
if (fs.existsSync(productsPath)) {
    try {
        products = JSON.parse(fs.readFileSync(productsPath, "utf8"));
        console.log("✅ Services loaded");
    } catch (e) { console.error("❌ Error loading products"); }
}

// 3. دالة الذكاء الاصطناعي (Groq - Llama 3.3 70B)
async function askAI(sender_psid, userMessage) {
    try {
        // إدارة الذاكرة (آخر 3 رسائل)
        if (!chatHistory[sender_psid]) chatHistory[sender_psid] = [];
        const history = chatHistory[sender_psid].map(msg => `${msg.role}: ${msg.content}`).join("\n");

        const prompt = `أنت موظف مبيعات محترف وحصري لوكالة ELAZ لخدمات الديجيتال.
        الخدمات المتاحة: ${JSON.stringify(products)}
        سياق المحادثة السابقة:
        ${history}

        القواعد الصارمة:
        1. **نطاق العمل فقط**: رد فقط في إطار خدمات الوكالة (ديزاين، إعلانات، أتمتة، برمجة).
        2. **ممنوع الدردشة الجانبية**: لو سألك عن أي حاجة بره الشغل، رد بـ: "بعتذر منك، تخصصي هو المساعدة في خدمات وكالة ELAZ فقط. تحب أساعدك في أي خدمة تانية؟"
        3. **تعدد اللغات**: رد بنفس لغة العميل (عربي، إنجليزي، أو غيره).
        4. **اللهجة المصرية**: لو العميل اتكلم عربي، رد بلهجة مصرية عامية "زتونة" ومختصرة جداً.
        5. **الذكاء الإملائي**: افهم الكلمات الغلط (عسان يقصد عشان، لوحو يقصد لوجو) وتجاوزها بذكاء.
        6. **التحويل للواتساب**: لو العميل طلب أوردر أو رقم للتواصل، وجهه لواتساب عمار: [اكتب رقمك هنا].

        رسالة العميل الحالية: ${userMessage}`;

        const response = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3 // تقليل الرقم ده بيخلي البوت جاد وملتزم بنطاق العمل
        }, {
            headers: { 
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            timeout: 10000
        });

        const aiResponse = response.data.choices[0]?.message?.content || "أهلاً بيك! محتاج مساعدة في خدماتنا؟";
        
        // تحديث الذاكرة
        chatHistory[sender_psid].push({ role: "user", content: userMessage });
        chatHistory[sender_psid].push({ role: "assistant", content: aiResponse });
        if (chatHistory[sender_psid].length > 6) chatHistory[sender_psid].shift();

        return aiResponse;
    } catch (error) {
        console.error("❌ AI Error:", error.response?.data || error.message);
        return "أهلاً بك في ELAZ 👋، كيف يمكننا مساعدتك في خدماتنا اليوم؟";
    }
}

// 4. دالة إرسال الرسالة مع أزرار الرد السريع (Quick Replies)
async function callSendAPI(sender_psid, text) {
    const messageData = {
        recipient: { id: sender_psid },
        message: {
            text: text,
            quick_replies: [
                { content_type: "text", title: "🎨 تصميم جرافيك", payload: "DESIGN" },
                { content_type: "text", title: "📢 إعلانات ممولة", payload: "ADS" },
                { content_type: "text", title: "🤖 أتمتة ذكية", payload: "AI" },
                { content_type: "text", title: "📞 تواصل معنا", payload: "CONTACT" }
            ]
        }
    };
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, messageData);
    } catch (err) { console.error("❌ FB SEND ERROR"); }
}

// 5. Webhook Verification
app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        res.sendStatus(403);
    }
});

// 6. استقبال ومعالجة الرسائل
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        res.status(200).send('EVENT_RECEIVED');
        for (const entry of body.entry) {
            const event = entry.messaging?.[0];
            if (event?.message?.text && !event.message.is_echo) {
                const aiResponse = await askAI(event.sender.id, event.message.text);
                await callSendAPI(event.sender.id, aiResponse);
            }
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 ELAZ Ultimate Bot is Live and Protected!"));
