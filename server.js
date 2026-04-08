const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require("fs");
const path = require("path");

const app = express().use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// 1. ذاكرة مؤقتة للمحادثات
const chatHistory = {};

// 2. تحميل الخدمات
let products = {};
const productsPath = path.join(__dirname, "products.json");
function loadProducts() {
    if (fs.existsSync(productsPath)) {
        try {
            products = JSON.parse(fs.readFileSync(productsPath, "utf8"));
            console.log("✅ Services details loaded");
        } catch (e) { console.error("❌ Error parsing products.json"); }
    }
}
loadProducts();

// 3. دالة الذكاء الاصطناعي (Groq - Llama 3.3 70B)
async function askAI(sender_psid, userMessage) {
    try {
        if (!chatHistory[sender_psid]) chatHistory[sender_psid] = [];
        const history = chatHistory[sender_psid].map(msg => `${msg.role}: ${msg.content}`).join("\n");

        const prompt = `أنت موظف مبيعات خبير في وكالة ELAZ لخدمات الديجيتال.
        بيانات الخدمات التفصيلية: ${JSON.stringify(products)}
        سياق المحادثة: ${history}

        قواعد الرد الاحترافية:
        1. **الشرح التفصيلي**: لو العميل سأل عن خدمة، اشرح له "التفاصيل" (Details) و "طريقة العمل" (Process) من ملف البيانات بذكاء.
        2. **نطاق العمل**: رد فقط في تخصصات الوكالة. لو سأل بره الموضوع، اعتذر بذكاء ورجعه لخدماتنا.
        3. **اللغات**: رد بنفس لغة العميل (عربي، إنجليزي.. إلخ).
        4. **اللهجة المصرية**: لو العميل اتكلم عربي، رد بمصري عامية "شيك" ومختصرة ومقنعة.
        5. **الذكاء الإملائي**: افهم الكلمات المكتوبة غلط (عسان، لوحو، اعلانات مموله) وكمل كلامك عادي.
        6. **التحويل**: لو العميل مهتم يطلب خدمة، وجهه لواتساب عمار: [حط رقمك هنا].

        رسالة العميل الحالية: ${userMessage}`;

        const response = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.4
        }, {
            headers: { "Authorization": `Bearer ${GROQ_API_KEY}` },
            timeout: 12000
        });

        const aiResponse = response.data.choices[0]?.message?.content || "منور في ELAZ! محتاج مساعدة في خدماتنا؟";
        
        // تحديث الذاكرة
        chatHistory[sender_psid].push({ role: "user", content: userMessage });
        chatHistory[sender_psid].push({ role: "assistant", content: aiResponse });
        if (chatHistory[sender_psid].length > 4) chatHistory[sender_psid].shift();

        return aiResponse;
    } catch (error) {
        console.error("❌ AI Error:", error.message);
        return "أهلاً بك في ELAZ 👋، نعتذر عن عطل بسيط، كيف يمكنني مساعدتك في خدماتنا؟";
    }
}

// 4. إرسال الرسالة مع أزرار رد سريع
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
    } catch (err) { console.error("❌ FB SEND Error"); }
}

// 5. Webhook
app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.status(200).send(req.query['hub.challenge']);
    else res.sendStatus(403);
});

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

app.listen(process.env.PORT || 3000, () => console.log("🚀 ELAZ Bot is officially a pro salesperson!"));
