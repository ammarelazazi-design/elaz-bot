const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express().use(bodyParser.json());

// المتغيرات الأساسية (تأكد من وجودها في Render Environment Variables)
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN;
const GROQ_API_KEY      = process.env.GROQ_API_KEY;
const AMMAR_PSID        = process.env.AMMAR_PSID;
const ZAPIER_WEBHOOK    = process.env.ZAPIER_WEBHOOK;

// التعليمات الصارمة لمنع "الصيني" والهبد
const SYSTEM_PROMPT = `أنت المساعد الذكي الرسمي لوكالة ELAZ للتسويق الرقمي والذكاء الاصطناعي. صاحب الوكالة هو أستاذ عمار.
قواعدك الصارمة:
1. اللغة: تحدث باللهجة المصرية (Egyptian Arabic) فقط. ممنوع تماماً الرد بالصيني أو الفرنساوي أو الإسباني.
2. الفرانكو: افهم الفرانكو جيداً ورد عليه باللهجة المصرية.
3. التخصص: (تصميم لوجو، إعلانات ممولة Media Buying، بوتات ذكاء اصطناعي).
4. ممنوع تأليف أسعار: دائماً اطلب رقم الموبايل عند السؤال عن التكلفة.
5. الشخصية: ذكي، محترف، ومختصر في الرد.`;

// 1. دالة إظهار "جاري الكتابة"
async function sendTyping(sid) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            sender_action: "typing_on"
        });
    } catch (e) {}
}

// 2. دالة إرسال رسالة ترحيبية بالأزرار
async function sendWelcomeButtons(sid) {
    const text = "أهلاً بيك في وكالة ELAZ! 🚀\nتحب تكمل مع مساعدنا الذكي ولا تحول لخدمة العملاء؟";
    const buttons = [
        { type: "postback", title: "الذكاء الاصطناعي 🤖", payload: "START_AI" },
        { type: "postback", title: "خدمة العملاء 👤", payload: "TALK_TO_HUMAN" }
    ];
    await sendButtons(sid, text, buttons);
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

// الـ Webhook الرئيسي
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        res.status(200).send('EVENT_RECEIVED');
        for (const entry of body.entry) {
            const event = entry.messaging?.[0];
            const sid = event?.sender?.id;

           // if (!sid || event.message?.is_echo || sid === AMMAR_PSID) continue;

            // تنفيذ ضغطات الأزرار
            if (event.postback) {
                const payload = event.postback.payload;
                if (payload === 'START_AI') {
                    await sendMsg(sid, "تمام! أنا معاك، حابب تعرف إيه عن خدماتنا في التصميم أو الإعلانات؟");
                } else if (payload === 'TALK_TO_HUMAN') {
                    await sendMsg(sid, "تم! سيب استفسارك ورقمك وأستاذ عمار أو حد من الفريق هيرد عليك فوراً.");
                }
                continue;
            }

            if (event.message?.text) {
                const userMsg = event.message.text.toLowerCase();
                
                // رادار الترحيب الذكي
                const welcomeRegex = /^(أهلا|اهلا|سلام|hi|hello|hey|ازيك|صباح|مساء|هلو|start|بدء|hola|welcome)/i;

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
                        
                        // تأخير لمدة ثانيتين للواقعية
                        setTimeout(async () => {
                            await sendMsg(sid, reply);
                            if (ZAPIER_WEBHOOK) {
                                axios.post(ZAPIER_WEBHOOK, { customer_id: sid, msg: userMsg, reply: reply }).catch(e => {});
                            }
                        }, 2000);
                    } catch (err) {
                        sendMsg(sid, "ثواني وعمار هيرد عليك بكل التفاصيل.");
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

app.get('/health', (req, res) => res.send("ELAZ Bot is Healthy! ✅"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 ELAZ Bot System is LIVE on port ${PORT}`));
