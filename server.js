const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express().use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN;
const GROQ_API_KEY      = process.env.GROQ_API_KEY;
const AMMAR_PSID        = process.env.AMMAR_PSID;

const SYSTEM_PROMPT = `أنت المساعد الذكي لوكالة ELAZ للتسويق (صاحبها أستاذ عمار).
قواعدك:
1. افهم (العربي، الإنجليزي، والفرانكو) ورد بنفس لغة العميل.
2. تخصصنا: (تصميم جرافيك، إعلانات ممولة، بوتات ذكاء اصطناعي).
3. لو العميل اختار "التحدث مع الذكاء الاصطناعي"، جاوبه بذكاء في صلب تخصصنا.
4. لو العميل سأل عن السعر، اطلب رقمه للتواصل.`;

// 1. دالة إظهار Typing
async function sendTyping(sid) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            sender_action: "typing_on"
        });
    } catch (e) {}
}

// 2. دالة إرسال الرسالة الترحيبية مع الأزرار
async function sendWelcomeMessage(sid) {
    const welcomeText = "أهلاً بك في وكالة ELAZ للتسويق الرقمي والذكاء الاصطناعي! 🚀\n\nأنا مساعدك الذكي، حابب نبدأ الكلام إزاي؟";
    const buttons = [
        { type: "postback", title: "الذكاء الاصطناعي 🤖", payload: "START_AI" },
        { type: "postback", title: "خدمة العملاء 👤", payload: "TALK_TO_HUMAN" }
    ];
    await sendButtons(sid, welcomeText, buttons);
}

// 3. دالة إرسال الأزرار
async function sendButtons(sid, text, buttons) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
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
    } catch (e) { console.error("Button error:", e.response?.data); }
}

// 4. دالة إرسال نص عادي
async function sendMsg(sid, text) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            message: { text }
        });
    } catch (e) {}
}

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        res.status(200).send('EVENT_RECEIVED');
        for (const entry of body.entry) {
            const event = entry.messaging?.[0];
            const sid = event?.sender?.id;
            //if (!sid || event.message?.is_echo || sid === AMMAR_PSID) continue;

            // التعامل مع ضغطات الأزرار (Postbacks)
            if (event.postback) {
                const payload = event.postback.payload;
                if (payload === 'START_AI') {
                    await sendMsg(sid, "تمام يا فنان! أنا معاك، تحب تعرف إيه عن خدماتنا في الجرافيك أو الإعلانات؟");
                } else if (payload === 'TALK_TO_HUMAN') {
                    await sendMsg(sid, "من عينيا! هحولك حالاً لأستاذ عمار أو حد من فريق خدمة العملاء وهيردوا عليك في أسرع وقت. سيب استفسارك هنا.");
                }
                continue;
            }

            // التعامل مع الرسائل النصية
            if (event.message?.text) {
                const userMsg = event.message.text;

                // لو أول مرة يبعت "Get Started" أو كلمة ترحيب
                if (userMsg.toLowerCase() === 'get_started' || userMsg === 'بدء') {
                    await sendWelcomeMessage(sid);
                } else {
                    await sendTyping(sid);
                    try {
                        const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                            model: 'llama-3.3-70b-versatile',
                            messages: [
                                { role: 'system', content: SYSTEM_PROMPT },
                                { role: 'user', content: userMsg }
                            ]
                        }, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });

                        let reply = aiRes.data.choices[0].message.content;
                        setTimeout(() => sendMsg(sid, reply), 2000);
                    } catch (err) {
                        sendMsg(sid, "ثواني وهرد عليك.");
                    }
                }
            }
        }
    } else { res.sendStatus(404); }
});

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else { res.sendStatus(403); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 ELAZ Bot LIVE on port ${PORT}`));
