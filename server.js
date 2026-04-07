const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios'); // السطر ده كان ناقص وده سبب المشكلة!
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express().use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// تهيئة Gemini (استخدم 1.5 flash لأنه الأكثر استقراراً حالياً)
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash" 
});

app.get('/webhook', (req, res) => {
    let mode = req.query['hub.mode'];
    let token = req.query['hub.verify_token'];
    let challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log("Webhook verified successfully ✅");
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
            if (!webhook_event) continue;

            const sender_psid = webhook_event.sender.id;

            if (webhook_event.message?.is_echo) continue;

            if (webhook_event.message && webhook_event.message.text) {
                const userMessage = webhook_event.message.text;

                try {
                    const result = await model.generateContent(userMessage);
                    const aiResponse = result.response.text();

                    await callSendAPI(sender_psid, aiResponse || "عفواً، مفيش رد متاح.");
                } catch (error) {
                    console.error("Gemini Error:", error);
                    await callSendAPI(sender_psid, "عطل في الـ AI: " + (error.message ? error.message.substring(0, 100) : "Unknown"));
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
        console.log("Message sent to FB ✅");
    } catch (err) {
        console.error("FB SEND ERROR:", err.response ? err.response.data : err.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is live on port ${PORT} 🚀`));
