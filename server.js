require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const app = express().use(bodyParser.json());

// الثوابت من البيئة المحيطة (الخزنة)
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MY_WHATSAPP_LINK = "https://wa.me/201021464304"; // لينك الواتساب بتاعك

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- دالة إرسال الـ Typing (بيكتب الآن) ---
async function sendTyping(sid) {
    try {
        await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            sender_action: "typing_on"
        });
    } catch (e) { console.error("Typing Error"); }
}

// --- دالة إرسال الرسائل النصية ---
async function sendMsg(sid, text) {
    try {
        await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            message: { text: text }
        });
    } catch (e) { console.error("Msg Error"); }
}

// --- دالة إرسال الأزرار ---
async function sendButtons(sid, text, buttons) {
    try {
        await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "button",
                        text: text,
                        buttons: buttons
                    }
                }
            }
        });
    } catch (e) { console.error("Buttons Error"); }
}

// --- دالة قائمة الخدمات ---
async function sendServicesMenu(sid) {
    const text = `اتفضل يا فندم، دي الأقسام اللي بنقدر نساعدك فيها في وكالة ELAZ:`;
    const buttons = [
        { type: "postback", title: "🎨 هوية بصرية", payload: "SRV_DESIGN" },
        { type: "postback", title: "📢 إعلانات ممولة", payload: "SRV_ADS" },
        { type: "postback", title: "🤖 بوتات ذكية", payload: "SRV_BOTS" }
    ];
    await sendButtons(sid, text, buttons);
}

// --- الربط مع الذكاء الاصطناعي (Groq) ---
async function askGroq(userMsg, name) {
    try {
        const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: `أنت "إيلاز" (ELAZ)، المساعد الذكي لوكالة ELAZ للتسويق والتصميم. صاحب الوكالة هو "عمار العزازي". ردك لازم يكون باللهجة المصرية العامية، محترم، واحترافي. لو سألك عن الخدمات، قوله إننا بنقدم هوية بصرية، إعلانات، وبوتات ذكية.` },
                { role: "user", content: userMsg }
            ]
        }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });
        return res.data.choices[0].message.content;
    } catch (e) { return "بعتذر يا فندم، حصل ضغط بسيط. اؤمرني محتاج إيه؟"; }
}

// --- الويب هوك (Webhook) ---
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

            // 1. التعامل مع الرسائل النصية
            if (messaging.message && messaging.message.text) {
                const userMsg = messaging.message.text;
                
                // الكلمات الافتتاحية
                if (/^(أهلا|اهلا|هلا|يا هلا|مرحبا|صباح الخير|مساء الخير|hi|hello|hey|سلام)$/i.test(userMsg)) {
                    await sendTyping(sid);
                    await sleep(1000);
                    await sendButtons(sid, `أهلاً بك يا فندم في وكالة ELAZ.. تحب تتواصل معانا إزاي؟`, [
                        { type: "postback", title: "تحدث مع إيلاز 🤖", payload: "START_AI" },
                        { type: "web_url", title: "خدمة العملاء 👤", url: MY_WHATSAPP_LINK
