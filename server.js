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

                // هنختصرهم في أهم رابطين عشان السرعة
                const urls = [
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
                    `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`
                ];

                let finalResponse = "";
                let lastError = "";

                for (let url of urls) {
                    try {
                        const response = await axios.post(url, {
                            contents: [{ parts: [{ text: userMessage }] }]
                        }, { timeout: 7000 });

                        if (response.data.candidates?.[0]?.content?.parts?.[0]?.text) {
                            finalResponse = response.data.candidates[0].content.parts[0].text;
                            break; 
                        }
                    } catch (e) {
                        // بيحفظ آخر خطأ حصل عشان يقولك عليه
                        lastError = e.response?.data?.error?.message || e.message;
                        console.error("Attempt failed:", lastError);
                    }
                }

                // لو مفيش رد، هيبعتلك السبب الحقيقي بدل "مشكلة في الاتصال"
                await callSendAPI(sender_psid, finalResponse || `خطأ محدد: ${lastError}`);
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
    } catch (err) { console.error("FB Error"); }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Debug Mode Live! 🚀`));
