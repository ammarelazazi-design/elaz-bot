const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require("fs");
const path = require("path");

const app = express().use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// وظيفة لقراءة ملف المنتجات
function getProductsData() {
    try {
        const data = fs.readFileSync(path.join(__dirname, "products.json"), "utf8");
        return data; // بيرجع البيانات كـ String للـ Prompt
    } catch (err) {
        console.error("Error reading products.json:", err);
        return "لا توجد بيانات حالية للخدمات.";
    }
}

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        res.sendStatus(403);
    }
});

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
                    const productsContext = getProductsData();
                    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

                    const prompt = `أنت المساعد الذكي لوكالة ELAZ لخدمات الديجيتال.
خدماتنا المتاحة هي:
${productsContext}

المطلوب:
- رد بلهجة مصرية احترافية وودودة.
- جاوب فقط من خلال الخدمات المتاحة.
- لو الخدمة "قريباً" وضح ده للعميل.
رسالة العميل: ${userMessage}`;

                    const response = await axios.post(url, {
                        contents: [{ parts: [{ text: prompt }] }]
                    });

                    const aiResponse = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "نورت إيلاز! نقدر نساعدك في إيه؟";
                    await callSendAPI(sender_psid, aiResponse);

                } catch (error) {
                    console.error("AI Error:", error.message);
                    await callSendAPI(sender_psid, "معلش حصل ضغط على السيستم، جرب كمان لحظة.");
                }
            }
        }
    }
});

async function callSendAPI(sender_psid, responseText) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sender_psid },
            message: { text: responseText }
        });
    } catch (err) { console.error("FB Error"); }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 ELAZ System Live"));
