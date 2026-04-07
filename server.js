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
    if (mode && token && mode === 'subscribe' && token === VERIFY_TOKEN) {
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
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

                // --- مصفوفة الروابط (عشان لو واحد فشل التاني يلحقه فوراً) ---
                const endpoints = [
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
                    `https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`
                ];

                let aiResponse = "عذراً، المحرك مشغول حالياً.";
                
                for (let url of endpoints) {
                    try {
                        const response = await axios.post(url, {
                            contents: [{ parts: [{ text: userMessage }] }]
                        }, { timeout: 5000 });

                        if (response.data.candidates?.[0]?.content?.parts?.[0]?.text) {
                            aiResponse = response.data.candidates[0].content.parts[0].text;
                            break; // لو اشتغل اخرج من اللوب فوراً
                        }
                    } catch (e) {
                        console.log(`Failed endpoint: ${url}`);
                        continue; // جرب الرابط اللي بعده
                    }
                }
                await callSendAPI(sender_psid, aiResponse);
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    }
});

async function callSendAPI(sender_psid, responseText) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sender_psid },
            message: { text: responseText }
        });
    } catch (err) { console.error("FB ERROR"); }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Live! 🚀`));
