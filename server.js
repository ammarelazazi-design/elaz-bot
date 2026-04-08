const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require("fs");
const path = require("path");

const app = express().use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ذاكرة مؤقتة للمحادثات (Context Memory)
const chatHistory = {};

// تحميل الخدمات
let products = {};
const productsPath = path.join(__dirname, "products.json");
if (fs.existsSync(productsPath)) {
    products = JSON.parse(fs.readFileSync(productsPath, "utf8"));
}

// دالة الذكاء الاصطناعي (Groq)
async function askAI(sender_psid, userMessage) {
    try {
        // إدارة الذاكرة: حفظ آخر 3 رسائل فقط لكل مستخدم
        if (!chatHistory[sender_psid]) chatHistory[sender_psid] = [];
        const history = chatHistory[sender_psid].map(msg => `${msg.role}: ${msg.content}`).join("\n");

        const prompt = `أنت موظف مبيعات في وكالة ELAZ. 
        الخدمات: ${JSON.stringify(products)}
        تاريخ المحادثة الأخير:
        ${history}

        القواعد:
        1. رد بلهجة مصرية عامية "زتونة" ومختصرة جداً.
        2. لو العميل سأل "بكام" أو "تفاصيل" افهم هو كان بيتكلم عن أنهي خدمة من المحادثة السابقة.
        3. لو العميل طلب يكلم حد أو يطلب أوردر، قوله يكلم "عمار" على واتساب: [حط رقمك هنا].
        4. ممنوع الرغي الكتير أو الرموز الغريبة.

        رسالة العميل الحالية: ${userMessage}`;

        const response = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.5
        }, {
            headers: { "Authorization": `Bearer ${GROQ_API_KEY}` },
            timeout: 10000
        });

        const aiResponse = response.data.choices[0]?.message?.content;
        
        // تحديث الذاكرة
        chatHistory[sender_psid].push({ role: "user", content: userMessage });
        chatHistory[sender_psid].push({ role: "assistant", content: aiResponse });
        if (chatHistory[sender_psid].length > 6) chatHistory[sender_psid].shift();

        return aiResponse;
    } catch (error) {
        console.error("AI Error");
        return "أهلاً بيك في ELAZ، محتاج مساعدة في تصميم أو إعلانات؟";
    }
}

// دالة إرسال الرسالة مع أزرار (Quick Replies)
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
    } catch (err) { console.error("FB SEND ERROR"); }
}

// Webhook
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

app.listen(process.env.PORT || 3000, () => console.log("🚀 ELAZ Ultimate Bot is Live!"));
