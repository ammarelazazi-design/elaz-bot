const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express().use(bodyParser.json());

// المفاتيح من Render Environment Variables
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN;
const GROQ_API_KEY      = process.env.GROQ_API_KEY;
const AMMAR_PSID        = process.env.AMMAR_PSID; // PSID //بتاعك عشان البوت يتجاهله

// ═══════════════════════════════════════════
//  دالة إرسال الرسائل لفيسبوك
// ═══════════════════════════════════════════
async function sendMsg(sid, text) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            message: { text }
        });
        console.log(`✅ تم الرد على: ${sid}`);
    } catch (e) {
        console.error("❌ فشل الإرسال:", e.response?.data || e.message);
    }
}

// ═══════════════════════════════════════════
//  الـ Webhook الرئيسي (POST)
// ═══════════════════════════════════════════
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        // رد فوري على فيسبوك عشان ما يكررش الطلب
        res.status(200).send('EVENT_RECEIVED');

        body.entry.forEach(async (entry) => {
            const event = entry.messaging?.[0];
            const sid = event?.sender?.id;

            // 1. تجاهل أي رسائل "صدى" طالعة من البوت نفسه
            if (event.message?.is_echo) return;

            // 2. تجاهل رسائلك أنت (عمار) عشان ما يحصلش Loop
            //if (!sid || sid === AMMAR_PSID) return;

            if (event.message && event.message.text) {
                const userMsg = event.message.text;
                console.log(`📩 رسالة من عميل (${sid}): ${userMsg}`);

                try {
                    // 3. طلب الرد من الذكاء الاصطناعي Groq
                    const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                        model: 'llama-3.3-70b-versatile',
                        messages: [
                            { role: 'system', content: 'أنت مساعد وكالة ELAZ للتسويق. رد بلهجة مصرية قصيرة وجذابة.' },
                            { role: 'user', content: userMsg }
                        ]
                    }, { 
                        headers: { Authorization: `Bearer ${GROQ_API_KEY}` } 
                    });

                    const reply = aiRes.data.choices[0].message.content;
                    await sendMsg(sid, reply);
                } catch (err) {
                    console.error("❌ خطأ في Groq API");
                    await sendMsg(sid, "ثواني وهرد عليك بكل التفاصيل يا فنان.");
                }
            }
        });
    } else {
        res.sendStatus(404);
    }
});

// ═══════════════════════════════════════════
//  التحقق من الـ Webhook (GET)
// ═══════════════════════════════════════════
app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        res.sendStatus(403);
    }
});

// نقطة مراقبة الحالة
app.get('/health', (req, res) => res.send("ELAZ Bot is LIVE! ✅"));

// تشغيل السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 السيرفر شغال على بورت ${PORT}`);
});
