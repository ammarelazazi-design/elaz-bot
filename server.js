const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express().use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.get('/webhook', (req, res) => {
    let mode = req.query['hub.mode'];
    let token = req.query['hub.verify_token'];
    let challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    }
});

app.post('/webhook', async (req, res) => {
    let body = req.body;

    if (body.object === 'page') {
        for (const entry of body.entry) {
            const webhook_event = entry.messaging?.[0];
            if (!webhook_event || webhook_event.message?.is_echo) continue;

            const sender_psid = webhook_event.sender.id;

            if (webhook_event.message && webhook_event.message.text) {
                const userMessage = webhook_event.message.text;

                try {
                    // التعديل هنا: استخدام مسار v1beta مع الموديل المباشر
                    const geminiResponse = await axios.post(
                        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
                        {
                            contents: [{
                                parts: [{ text: userMessage }]
                            }]
                        }
                    );

                    // التأكد من وجود بيانات في الرد قبل محاولة قراءتها
                    if (geminiResponse.data.candidates && geminiResponse.data.candidates[0].content) {
                        const aiResponse = geminiResponse.data.candidates[0].content.parts[0].text;
                        await callSendAPI(sender_psid, aiResponse);
                    } else {
                        await callSendAPI(sender_psid, "عذراً، المحرك لم يعطي رداً واضحاً.");
                    }

                } catch (error) {
                    console.error("Gemini Error:", error.response?.data || error.message);
                    // لو فشل تاني، هيبعتلك كود الخطأ عشان نصلحه فوراً
                    let errData = error.response?.data ? JSON.stringify(error.response.data) : error.message;
                    await callSendAPI(sender_psid, "خطأ جديد: " + errData.slice(0, 150));
                }
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

async function callSendAPI(sender_psid, responseText) {
    const request_body = {
        recipient: { id: sender_psid },
        message: { text: responseText }
    };

    try {
        await axios.post(
            `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            request_body
        );
    } catch (err) {
        console.error("FB SEND ERROR:", err.response ? err.response.data : err.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is live on port ${PORT} 🚀`));
