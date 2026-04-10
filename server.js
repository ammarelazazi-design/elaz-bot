require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const app = express().use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MY_WHATSAPP_LINK = "https://wa.me/201021464304";

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function sendTyping(sid) {
    try {
        await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid }, sender_action: "typing_on"
        });
    } catch (e) {}
}

async function sendMsg(sid, text) {
    try {
        await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid }, message: { text: text }
        });
    } catch (e) {}
}

async function sendButtons(sid, text, buttons) {
    try {
        await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            message: { attachment: { type: "template", payload: { template_type: "button", text: text, buttons: buttons } } }
        });
    } catch (e) {}
}

async function sendServicesMenu(sid) {
    await sendButtons(sid, `دي الأقسام اللي بنقدمها في ELAZ:`, [
        { type: "postback", title: "🎨 هوية بصرية", payload: "SRV_DESIGN" },
        { type: "postback", title: "📢 إعلانات ممولة", payload: "SRV_ADS" },
        { type: "postback", title: "🤖 بوتات ذكية", payload: "SRV_BOTS" }
    ]);
}
async function askGroq(userMsg) {
    try {
        const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "system", content: "أنت إيلاز، مساعد ذكي مصري لوكالة ELAZ. ردك عامي ومختصر." }, { role: "user", content: userMsg }]
        }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });
        return res.data.choices[0].message.content;
    } catch (e) { return "اؤمرني يا فندم، محتاج تعرف إيه؟"; }
}

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.send(req.query['hub.challenge']);
    else res.send('Error');
});

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            let messaging = entry.messaging[0];
            let sid = messaging.sender.id;
            if (messaging.message && messaging.message.text) {
                const userMsg = messaging.message.text;
                if (/^(أهلا|اهلا|هلا|مرحبا|صباح|مساء|hi|hello)$/i.test(userMsg)) {
                    await sendTyping(sid);
                    await sleep(1000);
                    await sendButtons(sid, `أهلاً بك في ELAZ.. تحب تتواصل معانا إزاي؟`, [
                        { type: "postback", title: "تحدث مع إيلاز 🤖", payload: "START_AI" },
                        { type: "web_url", title: "خدمة العملاء 👤", url: MY_WHATSAPP_LINK }
                    ]);
                } else {
                    await sendTyping(sid);
                    const reply = await askGroq(userMsg);
                    await sendMsg(sid, reply);
                }
            }
            if (messaging.postback) {
                const p = messaging.postback.payload;
                if (p === 'START_AI') {
                    await sendTyping(sid);
                    await sendButtons(sid, `أنا إيلاز المساعد الذكي.. تحب تشوف "الخدمات"؟`, [{ type: "postback", title: "الخدمات 📋", payload: "SHOW_SERVICES" }]);
                }
                if (p === 'SHOW_SERVICES') { await sendTyping(sid); await sendServicesMenu(sid); }
            }
        }
        res.sendStatus(200);
    }
});
app.listen(process.env.PORT || 3000, () => console.log('Running!'));
