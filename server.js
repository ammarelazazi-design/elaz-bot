const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express().use(bodyParser.json());

// المتغيرات من ريندر
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN;
const GROQ_API_KEY      = process.env.GROQ_API_KEY;
const AMMAR_PSID        = process.env.AMMAR_PSID;
const ZAPIER_WEBHOOK    = process.env.ZAPIER_WEBHOOK;

const SYSTEM_PROMPT = `أنت المساعد الذكي الرسمي لوكالة ELAZ للتسويق الرقمي والذكاء الاصطناعي. صاحب الوكالة هو أستاذ عمار.
قواعدك:
1. ردك بلهجة مصرية بيزنس محترمة، قصيرة، وذكية جداً.
2. خدماتنا: (تصميم لوجو وهوية بصرية، إعلانات ممولة Media Buying، برمجة بوتات ماسنجر، ودراسات جدوى تسويقية).
3. ممنوع تأليف أسعار أو عروض وهمية.
4. عند السؤال عن السعر: "الأسعار بتحدد حسب حجم مشروعك، سيب رقمك وأستاذ عمار هيتواصل معاك فوراً يوضحلك كل الباقات".
5. ممنوع الكلام في أي موضوع خارج التسويق وخدمات الوكالة.`;

// 1. دالة إظهار علامة "جاري الكتابة"
async function sendTyping(sid) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            sender_action: "typing_on"
        });
    } catch (e) { console.error("Typing error"); }
}

// 2. دالة إرسال الرسالة النهائية
async function sendMsg(sid, text) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            message: { text }
        });
        console.log(`✅ تم الرد على: ${sid}`);
    } catch (e) { console.error("Send error:", e.response?.data); }
}

// الـ Webhook
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        res.status(200).send('EVENT_RECEIVED');

        for (const entry of body.entry) {
            const event = entry.messaging?.[0];
            const sid = event?.sender?.id;

            if (!sid || event.message?.is_echo) continue;
            
            // تجاهل رسائل عمار (شيل // لو عايز تجذب من حسابك)
            //if (sid === AMMAR_PSID) continue; 

            if (event.message?.text) {
                const userMsg = event.message.text;
                
                // تفعيل علامة الكتابة فوراً
                await sendTyping(sid);

                try {
                    // طلب الرد من Groq
                    const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                        model: 'llama-3.3-70b-versatile',
                        messages: [
                            { role: 'system', content: SYSTEM_PROMPT },
                            { role: 'user', content: userMsg }
                        ]
                    }, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });

                    const reply = aiRes.data.choices[0].message.content;

                    // تأخير بسيط (ثانيتين) عشان العميل يشوف علامة الكتابة ويحس بواقعية
                    setTimeout(async () => {
                        await sendMsg(sid, reply);
                        
                        // إرسال لزابير لو اللينك موجود
                        if (ZAPIER_WEBHOOK) {
                            axios.post(ZAPIER_WEBHOOK, { customer_id: sid, msg: userMsg, reply: reply }).catch(e => {});
                        }
                    }, 2000);

                } catch (err) {
                    await sendMsg(sid, "ثواني وأستاذ عمار هيرد عليك بكل التفاصيل.");
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

app.get('/health', (req, res) => res.send("ELAZ Bot is LIVE! ✅"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 السيرفر شغال تمام على بورت ${PORT}`);
});
