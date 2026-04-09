const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require("fs");
const path = require("path");

// إجبار السيرفر على استخدام ترميز UTF-8
process.env.LANG = 'en_US.UTF-8';

const app = express().use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ZAPIER_WEBHOOK_URL = process.env.ZAPIER_WEBHOOK_URL;
const AMMAR_PSID = "8279251338792163"; 

let chatHistory = {};

// 1. نظام إشعارات الأخطاء لعمار
async function sendErrorToAmmar(errorMsg) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: AMMAR_PSID },
            message: { text: "⚠️ تنبيه: فيه مشكلة تقنية بسيطة حصلت في السيرفر." }
        });
    } catch (e) { console.error("Error log failed"); }
}

// 2. إرسال تنبيه مبيعات لعمار
async function sendAlertToAmmar(clientName, userMsg) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: AMMAR_PSID },
            message: { text: `🚨 عميل جديد: ${clientName}\nبيسأل عن: "${userMsg}"` }
        });
    } catch (e) {}
}

// 3. إرسال البيانات لـ Zapier
async function sendToZapier(clientData) {
    try {
        if (ZAPIER_WEBHOOK_URL) {
            await axios.post(ZAPIER_WEBHOOK_URL, clientData);
        }
    } catch (e) {}
}

// 4. جلب بيانات العميل
async function getUserInfo(sender_psid) {
    try {
        const response = await axios.get(`https://graph.facebook.com/${sender_psid}?fields=first_name,gender&access_token=${PAGE_ACCESS_TOKEN}`);
        return { firstName: response.data.first_name || "عزيزي", gender: response.data.gender || "unknown" };
    } catch (error) { return { firstName: "عزيزي", gender: "unknown" }; }
}

// 5. محرك الذكاء الاصطناعي
async function askAI(sender_psid, userMessage, userInfo) {
    try {
        const prompt = `أنت مساعد وكالة ELAZ الرقمية. العميل: ${userInfo.firstName}.
        القواعد: 
        - رد بلهجة العميل (مصرية أو فصحى).
        - لو سأل عن السعر: وضح أنه حسب حجم الشغل والمدة.
        - لو طلب ميعاد: بلغه إنك أرسلت طلباً لعمار.
        - الردود مختصرة ومنظمة.
        رسالة العميل: "${userMessage}"`;

        const response = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.6
        }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}` }, timeout: 12000 });

        return response.data.choices[0]?.message?.content;
    } catch (error) {
        await sendErrorToAmmar(error.message);
        return `أهلاً يا ${userInfo.firstName}، واجهت مشكلة بسيطة، أستاذ عمار هيتواصل معاك حالاً.`;
    }
}

// 6. إرسال الرسالة النهائية
async function callSendAPI(sender_psid, text) {
    try {
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
    } catch (e) {}
}

// 7. الـ Webhook
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        res.status(200).send('EVENT_RECEIVED');
        for (const entry of body.entry) {
            const event = entry.messaging?.[0];
            if (event?.message?.text && !event.message.is_echo) {
                const sid = event.sender.id;
                if (sid === AMMAR_PSID) return;

                const userInfo = await getUserInfo(sid);
                const userMsg = event.message.text.toLowerCase();

                // تفعيل "جاري الكتابة"
                await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
                    recipient: { id: sid }, sender_action: "typing_on"
                }).catch(e => {});

                // فحص الكلمات اللقطة (سعر/ميعاد)
                const triggers = ["سعر", "بكام", "كم", "موعد", "ميعاد", "احجز", "كلمني"];
                if (triggers.some(word => userMsg.includes(word))) {
                    await sendAlertToAmmar(userInfo.firstName, event.message.text);
                    await sendToZapier({
                        name: userInfo.firstName,
                        message: event.message.text,
                        time: new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' })
                    });
                }

                const aiResponse = await askAI(sid, event.message.text, userInfo);
                
                setTimeout(() => {
                    callSendAPI(sid, aiResponse);
                }, 3000);
            }
        }
    }
});

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.status(200).send(req.query['hub.challenge']);
    else res.sendStatus(403);
});

app.listen(process.env.PORT || 3000);
