const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require("fs");

// إعداد السيرفر
const app = express().use(bodyParser.json());

// المفاتيح من إعدادات Render
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ZAPIER_WEBHOOK_URL = process.env.ZAPIER_WEBHOOK_URL;
const AMMAR_PSID = "8279251338792163"; 

// 1. إعداد واجهة الصفحة (بتشتغل مرة واحدة)
async function setupMessengerProfile() {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messenger_profile?access_token=${PAGE_ACCESS_TOKEN}`, {
            "get_started": { "payload": "START_ELAZ" },
            "greeting": [{
                "locale": "default",
                "text": "أهلاً بيك في إيلاز 🚀\nبنساعدك تكبر شغلك وتزود مبيعاتك من خلال التصميم، الإعلانات، وحلول الذكاء الاصطناعي.\n\nدوس على (بدء الاستخدام) وخلينا نبدأ."
            }]
        });
        console.log("✅ تم ضبط واجهة الصفحة بنجاح");
    } catch (e) { console.error("❌ فشل ضبط الواجهة"); }
}

// 2. جلب اسم العميل
async function getUserInfo(psid) {
    try {
        const res = await axios.get(`https://graph.facebook.com/${psid}?fields=first_name&access_token=${PAGE_ACCESS_TOKEN}`);
        return res.data.first_name || "عزيزي العميل";
    } catch (e) { return "عزيزي العميل"; }
}

// 3. الـ Webhook الرئيسي
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        res.status(200).send('EVENT_RECEIVED');
        
        for (const entry of body.entry) {
            const event = entry.messaging?.[0];
            const sid = event?.sender?.id;
            if (!sid || sid === AMMAR_PSID) continue;

            const firstName = await getUserInfo(sid);

            // أ- لو داس على زرار البداية
            if (event.postback?.payload === 'START_ELAZ') {
                const welcomeMsg = `أهلاً بيك يا ${firstName} في إيلاز 🚀
بنساعدك تكبر شغلك وتزود مبيعاتك من خلال:
- تصميم احترافي
- إعلانات ممولة
- حلول ذكاء اصطناعي

احكيلي محتاج إيه بالظبط وأنا أرشحلك الحل المناسب 👌`;
                await sendMsg(sid, welcomeMsg);
                continue;
            }

            // ب- لو بعت رسالة نصية
            if (event.message?.text && !event.message.is_echo) {
                const userMsg = event.message.text;

                // تنبيه لزابير وعمار لو فيه (سعر أو ميعاد)
                if (["سعر", "بكام", "ميعاد", "احجز", "كام"].some(w => userMsg.includes(w))) {
                    if (ZAPIER_WEBHOOK_URL) {
                        axios.post(ZAPIER_WEBHOOK_URL, { name: firstName, message: userMsg, time: new Date().toLocaleString('ar-EG') });
                    }
                    // تنبيه ليك شخصياً
                    sendMsg(AMMAR_PSID, `🚨 عميل بيسأل عن سعر/ميعاد:\nالاسم: ${firstName}\nالرسالة: ${userMsg}`);
                }

                // الرد بالذكاء الاصطناعي
                const aiResponse = await askGroq(userMsg, firstName);
                await sendMsg(sid, aiResponse);
            }
        }
    }
});

// 4. محرك الذكاء الاصطناعي (Groq)
async function askGroq(text, name) {
    try {
        const response = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: `أنت مساعد وكالة ELAZ. العميل اسمه ${name}. رد بلهجة مصرية محترمة ومختصرة جداً عن خدماتنا (تصميم، ماركتنج، بوتات). لو سأل عن سعر قوله إن أستاذ عمار هيكلمه يحدد معاه. رسالة العميل: ${text}` }]
        }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}` } });
        return response.data.choices[0].message.content;
    } catch (e) { return "وصلت رسالتك يا فنان، أستاذ عمار هيتواصل معاك حالاً."; }
}

// 5. دالة إرسال الرسائل
async function sendMsg(sid, text) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            message: { text: text }
        });
    } catch (e) {}
}

// التحقق من الـ Webhook
app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.status(200).send(req.query['hub.challenge']);
    else res.sendStatus(403);
});

// تشغيل السيرفر
app.listen(process.env.PORT || 3000, () => {
    console.log("🚀 ELAZ System is LIVE!");
    setupMessengerProfile();
});
