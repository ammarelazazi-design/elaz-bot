const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express().use(bodyParser.json());

// المتغيرات اللي بناخدها من إعدادات ريندر (Environment Variables)
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// إعداد الذكاء الاصطناعي
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// 1. كود التحقق من الـ Webhook (عشان فيسبوك يوافق يربط)
app.get('/webhook', (req, res) => {
    let mode = req.query['hub.mode'];
    let token = req.query['hub.verify_token'];
    let challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED ✅');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    }
});

// 2. استقبال الرسائل ومعالجتها
app.post('/webhook', async (req, res) => {
    let body = req.body;

    if (body.object === 'page') {
        body.entry.forEach(async (entry) => {
            let webhook_event = entry.messaging[0];
            let sender_psid = webhook_event.sender.id;

            if (webhook_event.message && webhook_event.message.text) {
                let userMessage = webhook_event.message.text;
                console.log(`Message from ${sender_psid}: ${userMessage}`);

                // إرسال الكلام لـ Gemini
                try {
                    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                    const result = await model.generateContent(userMessage);
                    const aiResponse = result.response.text();

                    // إرسال رد الذكاء الاصطناعي للمستخدم على مسنجر
                    await callSendAPI(sender_psid, aiResponse);
                } catch (error) {
                    console.error("Gemini Error:", error);
                    await callSendAPI(sender_psid, "عذراً، واجهت مشكلة في التفكير حالياً. حاول ثانية!");
                }
            }
        });
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// وظيفة إرسال الرسالة لفيسبوك
async function callSendAPI(sender_psid, response) {
    let request_body = {
        "recipient": { "id": sender_psid },
        "message": { "text": response }
    };

    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, request_body);
        console.log('Message sent! 🚀');
    } catch (err) {
        console.error("Facebook Send Error:", err.response.data);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is live on port ${PORT} 🚀`));
