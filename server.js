const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require("fs");
const path = require("path");

const app = express().use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

let chatHistory = {};

// 1. جلب بيانات العميل (الاسم والجنس)
async function getUserInfo(sender_psid) {
    try {
        const response = await axios.get(`https://graph.facebook.com/${sender_psid}?fields=first_name,gender&access_token=${PAGE_ACCESS_TOKEN}`);
        return {
            firstName: response.data.first_name || "عزيزي العميل",
            gender: response.data.gender || "unknown"
        };
    } catch (error) {
        return { firstName: "عزيزي العميل", gender: "unknown" };
    }
}

// 2. محرك الذكاء الاصطناعي (النسخة الحرباء)
async function askAI(sender_psid, userMessage, userInfo) {
    try {
        if (!chatHistory[sender_psid]) chatHistory[sender_psid] = [];
        const history = chatHistory[sender_psid].map(msg => `${msg.role}: ${msg.content}`).join("\n");

        let products = "";
        try {
            products = fs.readFileSync(path.join(__dirname, "products.json"), "utf8");
        } catch (e) { products = "خدمات جرافيك، إعلانات، وبوتات ذكية."; }

        const prompt = `أنت المساعد الذكي لوكالة ELAZ. 
        العميل: ${userInfo.firstName} | الجنس: ${userInfo.gender}
        رسالة العميل: "${userMessage}"

        قواعدك:
        1. **المحاكاة اللغوية**: رد بنفس لغة ونبرة العميل (عامية مصرية، فصحى، أو إنجليزي).
        2. **التشخيص**: خاطب العميل باسمه ${userInfo.firstName} بأسلوب لبق يناسب جنسه.
        3. **الزتونة**: رد في نقاط مختصرة (1.. 2.. 3..).
        4. **التخصص**: ممنوع الرغي في مواضيع خارج الوكالة (أفلام، كورة، إلخ). اعتذر بلباقة ورجعه لخدماتنا.
        5. **التواصل**: رقم واتساب عمار هو 01557963125.
        
        بيانات الخدمات: ${products}

        رد الآن بذكاء:`;

        const response = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.6
        }, {
            headers: { "Authorization": `Bearer ${GROQ_API_KEY}` },
            timeout: 15000
        });

        const aiResponse = response.data.choices[0]?.message?.content;
        chatHistory[sender_psid].push({ role: "user", content: userMessage });
        chatHistory[sender_psid].push({ role: "assistant", content: aiResponse });
        if (chatHistory[sender_psid].length > 6) chatHistory[sender_psid].shift();

        return aiResponse;
    } catch (error) {
        return `أهلاً بك يا ${userInfo.firstName}، كيف يمكنني مساعدتك في خدمات وكالة ELAZ؟`;
    }
}

// 3. إرسال الرسائل
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

// 4. الـ Webhook الرئيسي
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        res.status(200).send('EVENT_RECEIVED');
        for (const entry of body.entry) {
            const event = entry.messaging?.[0];
            if (event?.message?.text && !event.message.is_echo) {
                const sid = event.sender.id;

                // ميزة استخراج الرقم ليك يا عمار
                if (event.message.text.trim() === "رقمي") {
                    await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
                        recipient: { id: sid },
                        message: { text: "الـ ID بتاعك هو: " + sid }
                    });
                    return;
                }

                const userInfo = await getUserInfo(sid);
                
                // إظهار جاري الكتابة
                await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
                    recipient: { id: sid }, sender_action: "typing_on"
                }).catch(e => {});

                const aiResponse = await askAI(sid, event.message.text, userInfo);
                await callSendAPI(sid, aiResponse);
            }
        }
    }
});

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.status(200).send(req.query['hub.challenge']);
    else res.sendStatus(403);
});

app.listen(process.env.PORT || 3000, () => console.log("🚀 ELAZ Ultimate AI is Live!"));
