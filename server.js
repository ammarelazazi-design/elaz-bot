const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express().use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN;
const GROQ_API_KEY      = process.env.GROQ_API_KEY;
const AMMAR_PSID        = process.env.AMMAR_PSID;

// دالة الإرسال
async function sendMsg(sid, text) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            message: { text }
        });
        console.log(`✅ تم إرسال رد لـ: ${sid}`);
    } catch (e) {
        console.error("❌ خطأ في الإرسال لفيسبوك:", e.response?.data || e.message);
    }
}

// الـ Webhook
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        res.status(200).send('EVENT_RECEIVED');

        for (const entry of body.entry) {
            const event = entry.messaging?.[0];
            const sid = event?.sender?.id;

            // لو مفيش ID أو اللي باعت هو عمار (أدمن الصفحة) - تجاهل
            if (!sid || sid === AMMAR_PSID) continue;

            if (event.message && event.message.text) {
                const userMsg = event.message.text;
                console.log(`📩 رسالة من العميل: ${userMsg}`);

                try {
                    // طلب الرد من ذكاء اصطناعي (Groq)
                    const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                        model: 'llama-3.3-70b-versatile',
                        messages: [
                            { role: 'system', content: 'أنت مساعد وكالة ELAZ. رد بلهجة مصرية قصيرة جداً.' },
                            { role: 'user', content: userMsg }
                        ]
                    }, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });

                    const reply = aiRes.data.choices[0].message.content;
                    await sendMsg(sid, reply);
                } catch (err) {
                    console.error("❌ خطأ في Groq API");
                    await sendMsg(sid, "ثواني يا فنان وهرد عليك بكل التفاصيل.");
                }
            }
        }
    } else {
        res.sendStatus(404);
    }
});

// التحقق من الـ Webhook
app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        res.sendStatus(403);
    }
});

app.get('/health', (req, res) => res.send("Bot is UP! 🚀"));

app.listen(process.env.PORT || 3000, () => console.log('🚀 Server is running...'));
