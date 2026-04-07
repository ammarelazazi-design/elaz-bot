const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express().use(bodyParser.json());

// المتغيرات اللي بنجيبها من Render Environment Variables
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// التحقق من Webhook (عشان فيسبوك يتأكد إن السيرفر بتاعك شغال)
app.get('/webhook', (req, res) => {
    let mode = req.query['hub.mode'];
    let token = req.query['hub.verify_token'];
    let challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    }
});

// استقبال الرسائل من فيسبوك
app.post('/webhook', async (req, res) => {
    let body = req.body;

    if (body.object === 'page') {
        body.entry.forEach(async (entry) => {
            if (entry.messaging && entry.messaging[0]) {
                let webhook_event = entry.messaging[0];
                let sender_psid = webhook_event.sender.id;

                if (webhook_event.message && webhook_event.message.text) {
                    let userMessage = webhook_event.message.text;
                    console.log("Message from user:", userMessage);

                    try {
                        // كود الربط المباشر مع Google Gemini 1.5 Flash
                        const response = await axios.post(
                            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
                            {
                                contents: [{ parts: [{ text: userMessage }] }]
                            }
                        );

                        // استخراج نص الرد من نتيجة جوجل
                        const aiResponse = response.data.candidates[0].content.parts[0].text;
                        
                        // إرسال الرد للمستخدم على مسنجر
                        await callSendAPI(sender_psid, aiResponse);
                    } catch (error) {
                        console.error("Gemini Error:", error.response ? error.response.data : error.message);
                        let errorDetail = error.response ? JSON.stringify(error.response.data) : error.message;
                        await callSendAPI(sender_psid, "خطأ في المحرك: " + errorDetail);
                    }
                }
            }
        });
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// وظيفة إرسال الرسائل لفيسبوك
async function callSendAPI(sender_psid, responseText) {
    let request_body = {
        "recipient": { "id": sender_psid },
        "message": { "text": responseText }
    };

    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, request_body);
        console.log('Message sent to Facebook! 🚀');
    } catch (err) {
        console.error("FB SEND ERROR:", err.response ? err.response.data : err.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is live on port ${PORT} 🚀`));
