const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require("fs");
const path = require("path");

const app = express().use(bodyParser.json());

// المفاتيح المسحوبة من إعدادات Render
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ZAPIER_WEBHOOK_URL = process.env.ZAPIER_WEBHOOK_URL;
const AMMAR_PSID = "8279251338792163"; 

let chatHistory = {};

// 1. نظام إشعارات الأخطاء لعمار (لو السيرفر تعب يبعتلك)
async function sendErrorToAmmar(errorMsg) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: AMMAR_PSID },
            message: { text: `⚠️ الحقني يا عمار أنا واقع!\nالسبب: ${errorMsg}` }
        });
    } catch (e) { console.error("Error reporting failed"); }
}

// 2. إرسال تنبيه مبيعات لعمار (ماسنجر)
async function sendAlertToAmmar(clientName, userMsg) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: AMMAR_PSID },
            message: { text: `🚨 عميل لقطة يا عمار!\nالاسم: ${clientName}\nبيسأل عن: "${userMsg}"\nادخل خلص البيعة دلوقتي.` }
        });
    } catch (e) {}
}

// 3. إرسال البيانات لـ Zapier (جوجل شيتس)
async function sendToZapier(clientData) {
    try {
        if (ZAPIER_WEBHOOK_URL) {
            await axios.post(ZAPIER_WEBHOOK_URL, clientData);
            console.log("✅ البيانات وصلت لزابير");
        }
    } catch (e) { console.error("❌ فشل إرسال البيانات لزابير"); }
}

// 4. جلب بيانات العميل (الاسم والنوع)
async function getUserInfo(sender_psid) {
    try {
        const response = await axios.get(`https://graph.facebook.com/${sender_psid}?fields=first_name,gender&access_token=${PAGE_ACCESS_TOKEN}`);
        return { firstName: response.data.first_name || "عزيزي العميل", gender: response.data.gender || "unknown" };
    } catch (error) { return { firstName: "عزيزي العميل", gender: "unknown" }; }
}

// 5. محرك الذكاء الاصطناعي (الردود الذكية)
async function askAI(sender_psid, userMessage, userInfo) {
    try {
        let products = "";
        try { products = fs.readFileSync(path.join(__dirname, "products.json"), "utf8"); } catch (e) { products = "خدمات جرافيك وتسويق وبوتات."; }

        const prompt = `أنت المساعد الذكي لوكالة ELAZ. العميل: ${userInfo.firstName} | الجنس: ${userInfo.gender}.
        القواعد:
        1. رد بنفس لغة ونبرة العميل (عامية مصرية/فصحى).
        2. الأسعار: وضّح أنها تعتمد على حجم الشغل والمدة (لا تعطِ سعراً ثابتاً).
        3. المواعيد: بلغه إنك أبلغت "أستاذ عمار" وهيرد عليه حالاً.
        4. معرض الأعمال: لو سأل، وجهه لزيارة معرض أعمالنا.
        5. الزتونة: ردود مختصرة في نقاط.
        
        رسالة العميل: "${userMessage}"
        الخدمات: ${products}`;

        const response = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.6
        }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}` }, timeout: 12000 });

        return response.data.choices[0]?.message?.content;
    } catch (error) {
        await sendErrorToAmmar(error.message);
        return `أهلاً يا ${userInfo.firstName}، واجهت مشكلة بسيطة، أستاذ عمار هيتواصل معاك فوراً لحل طلبك.`;
    }
}

// 6. إرسال الرسائل النهائية
async function callSendAPI(sender_psid, text) {
    await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
        recipient: { id: sender_psid },
        message: {
            text: text,
            quick_replies: [
                { content_type: "text", title: "🎨 الخدمات", payload: "SERVICES" },
                { content_type: "text", title: "📞 تواصل مباشر", payload: "CONTACT" }
            ]
        }
    });
}

// 7. الـ Webhook الرئيسي
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        res.status(200).send('EVENT_RECEIVED');
        for (const entry of body.entry) {
            const event = entry.messaging?.[0];
            if (event?.message?.text && !event.message.is_echo) {
                const sid = event.sender.id;
                if (sid === AMMAR_PSID) return; // عشان ميردش عليك أنت

                const userInfo = await getUserInfo(sid);
                const userMsg = event.message.text.toLowerCase();

                // تفعيل جاري الكتابة
                await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
                    recipient: { id: sid }, sender_action: "typing_on"
                }).catch(e => {});

                // فحص الكلمات "اللقطة" (سعر أو ميعاد)
                const triggerWords = ["ميعاد", "موعد", "احجز", "مقابلة", "مكالمة", "كلمني", "بكم", "سعر", "السعر"];
                if (triggerWords.some(word => userMsg.includes(word))) {
                    await sendAlertToAmmar(userInfo.firstName, event.message.text);
                    await sendToZapier({
                        name: userInfo.firstName,
                        message: event.message.text,
                        time: new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' })
                    });
                }

                const aiResponse = await askAI(sid, event.message.text, userInfo);
                
                // تأخير 3 ثواني للواقعية
                setTimeout(async () => {
                    await callSendAPI(sid, aiResponse);
                }, 3000);
            }
        }
    }
});

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.status(200).send(req.query['hub.challenge']);
    else res.sendStatus(403);
});

app.listen(process.env.PORT || 3000, () => console.log("🚀 ELAZ Full System is Online!"));
