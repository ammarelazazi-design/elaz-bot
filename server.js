const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express().use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN;
const GROQ_API_KEY      = process.env.GROQ_API_KEY;
const AMMAR_PSID        = process.env.AMMAR_PSID;
const ZAPIER_WEBHOOK    = process.env.ZAPIER_WEBHOOK;

const MY_WHATSAPP_LINK = "https://wa.me/201201550186"; 

// ... (باقي الكود من فوق زي ما هو)

const SYSTEM_PROMPT = `أنت المساعد الذكي الرسمي لوكالة ELAZ للتسويق الرقمي والذكاء الاصطناعي.
قواعدك الصارمة للتعامل:
1. اللغة: رد باللهجة المصرية "بيزنس" راقية جداً وبصيغة الجمع (إحنا، فريقنا) والتحدث بجميع لغات العالم والفرانكوز
2. الاحترام: يجب استخدام كلمات (حضرتك، يا فندم، اتفضل حضرتك) في كل جملة.
3. ميزة ضبط النفس: مهما كان أسلوب العميل (حتى لو أخطأ في حق الوكالة أو انفعل)، يجب أن تظل محترماً جداً ومهذباً وبأعلى درجات الرقي.
4. التخصص: (تصميم الهوية البصرية، الميديا باينج، برمجة بوتات الذكاء الاصطناعي).
5. رد الأسعار: "بناءً على احتياجات مشروع حضرتك، بنحدد التكلفة، اتفضل سيب رقم موبايلك وفريقنا هيتواصل مع حضرتك فوراً لتوضيح كل الباقات".`;
// ... 

            if (event.postback) {
                if (event.postback.payload === 'START_AI') {
                    await sendTyping(sid);
                    // التعديل اللي طلبت بالظبط:
                    setTimeout(() => sendMsg(sid, "إحنا معاك، اتفضل حضرتك حابب تعرف إيه عن خدماتنا في التصميم أو الإعلانات؟"), 1000);
                }
                continue;
            }

// ... (باقي الكود)

async function sendTyping(sid) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            sender_action: "typing_on"
        });
    } catch (e) {}
}

async function sendWelcomeButtons(sid) {
    await sendTyping(sid);
    const text = "أهلاً بكم في وكالة ELAZ للتسويق الرقمي! 🚀\nحابين تبدأوا الكلام مع مساعدنا الذكي ولا تحولوا لخدمة العملاء؟";
    const buttons = [
        { type: "postback", title: "الذكاء الاصطناعي 🤖", payload: "START_AI" },
        { type: "web_url", title: "خدمة العملاء (واتساب) 👤", url: MY_WHATSAPP_LINK }
    ];
    
    setTimeout(async () => {
        await sendButtons(sid, text, buttons);
    }, 1500);
}

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

            if (event.postback) {
                if (event.postback.payload === 'START_AI') {
                    await sendTyping(sid);
                    setTimeout(() => sendMsg(sid, "تمام جداً! إحنا معاكم، حابين تعرفوا إيه عن خدماتنا في التصميم أو الإعلانات؟"), 1000);
                }
                continue;
            }

            if (event.message?.text) {
                const userMsg = event.message.text.toLowerCase();
                // تم إصلاح الـ Regex لمنع أخطاء الـ Deploy
                const welcomeRegex = /^(أهلا|اهلا|سلام|hi|hello|hey|ازيك|صباح|مساء|هلو|start|بدء|welcome|؟|\?)/i;

                if (welcomeRegex.test(userMsg)) {
                    await sendWelcomeButtons(sid);
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
                        
                        setTimeout(async () => {
                            await sendMsg(sid, reply);
                            if (ZAPIER_WEBHOOK) {
                                axios.post(ZAPIER_WEBHOOK, { customer_id: sid, msg: userMsg, reply: reply }).catch(e => {});
                            }
                        }, 2000);
                    } catch (err) {
                        sendMsg(sid, "ثواني وفريقنا هيرد عليكم بكل التفاصيل.");
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
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 ELAZ System is LIVE!`));
