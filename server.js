require('dotenv').config();
const express = require('express'), bodyParser = require('body-parser'), axios = require('axios');
const fs = require('fs'), path = require('path');
const app = express().use(bodyParser.json());

const { PAGE_ACCESS_TOKEN, VERIFY_TOKEN, OPENROUTER_API_KEY, GOOGLE_SHEET_URL } = process.env;
const MY_WHATSAPP_LINK = "https://wa.me/201557963125";
const DB_FILE = path.join(__dirname, 'db.json');

// قاعدة البيانات لتتبع العملاء
const loadDB = () => JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const saveDB = (db) => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

// ============================================================
// 🧠 الـ AI الاستراتيجي (عقل الوكالة)
// ============================================================
async function elazAI(message, context) {
    try {
        const res = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            model: "openai/gpt-3.5-turbo",
            messages: [{ 
                role: "system", 
                content: `أنت المساعد التنفيذي لوكالة ELAZ الرقمية. 
                - العميل باعت: "${message}". سياق العميل: ${JSON.stringify(context)}.
                - هدفك: حجز استشارة (اسم، تفاصيل، تليفون).
                - قواعدك: 
                  1. ممنوع الكلام في السياسة، الدين، الكورة، أو الهزار الخارج.
                  2. لو العميل خرج عن الشغل، قوله بلباقة: "أنا هنا عشان أساعدك تكبّر البيزنس بتاعك في ELAZ، خلينا نركز في طلبك".
                  3. لو طلب يشوف شغلك، قوله "أبهرني بتركيزك، شوف معرض أعمالنا فوق وهبعتلك البروفايل حالا".
                  4. اللغة: مصري بأسلوب Business Class.`
            }]
        }, { headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}` } });
        return res.data.choices[0].message.content;
    } catch (e) { return "نورت وكالة ELAZ.. حابب نبدأ في أي خدمة من خدماتنا؟"; }
}

// ============================================================
// 📡 نظام الإبهار البصري (Portfolio Cards)
// ============================================================
const fbAPI = (data) => axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, data);

async function sendGlowPortfolio(sid) {
    const data = {
        recipient: { id: sid },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "generic",
                    elements: [
                        {
                            title: "💎 Branding: ARMADA Foods",
                            image_url: "رابط_صورة_ارماندا_هنا.jpg",
                            subtitle: "تصميم هوية بصرية كاملة لبراند أغذية عالمي.",
                            buttons: [{ type: "postback", title: "محتاج تصميم زي ده", payload: "START_BOOKING" }]
                        },
                        {
                            title: "🚀 Marketing: LAPO Loan",
                            image_url: "رابط_صورة_لابو_هنا.jpg",
                            subtitle: "بناء علامة تجارية قوية لشركات التمويل.",
                            buttons: [{ type: "postback", title: "عايز أكبر مشروعي", payload: "START_BOOKING" }]
                        },
                        {
                            title: "🤖 AI Solutions: ELAZ Bots",
                            image_url: "https://images.unsplash.com/photo-1531746790731-6c087fecd65a?w=500",
                            subtitle: "بوتات ذكية بتدير شغلك وتبيع للعملاء مكانك.",
                            buttons: [{ type: "postback", title: "امتلك بوتك الخاص", payload: "START_BOOKING" }]
                        }
                    ]
                }
            }
        }
    };
    await fbAPI(data);
}

// ============================================================
// 📲 منطق الشغل الصارم (Work Logic)
// ============================================================
async function processMessage(sid, text, client) {
    const db = loadDB();
    const reply = await elazAI(text, client);

    // التحقق من "النية" قبل الانتقال للخطوات
    const isBotControl = text.includes("ليه") || text.includes("مين") || text.length < 2;

    if (client.awaitingBooking && !isBotControl) {
        if (client.step === 1) { client.name = text; client.step = 2; }
        else if (client.step === 2) { client.details = text; client.step = 3; }
        else if (client.step === 3 && /[0-9]/.test(text)) {
            client.phone = text;
            // حفظ في الشيت
            if (GOOGLE_SHEET_URL) try { await axios.post(GOOGLE_SHEET_URL, { name: client.name, details: client.details, phone: client.phone }); } catch(e){}
            client.awaitingBooking = false; client.step = 0;
            saveDB(db);
            await fbAPI({ recipient: { id: sid }, message: { text: "عاش يا بطل! بياناتك وصلت للمدير التنفيذي لـ ELAZ. استنى مكالمتنا. ✨" } });
            await fbAPI({ recipient: { id: sid }, message: { attachment: { type: "template", payload: { template_type: "button", text: "تقدر كمان تبعت استفسارك واتساب مباشرة:", buttons: [{ type: "web_url", title: "واتساب مباشر 🟢", url: MY_WHATSAPP_LINK }] } } } });
            return;
        }
    }

    saveDB(db);
    await fbAPI({ recipient: { id: sid }, message: { text: reply } });
    if (!client.awaitingBooking) await sendGlowPortfolio(sid);
}

// ============================================================
// 🔗 Webhook & Servers
// ============================================================
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object !== 'page') return res.sendStatus(404);

    for (let entry of body.entry) {
        const msg = entry.messaging[0];
        if (!msg) continue;
        const sid = msg.sender.id;
        const db = loadDB();
        if (!db.clients[sid]) db.clients[sid] = { sid, step: 0, awaitingBooking: false };
        const client = db.clients[sid];

        if (msg.message?.text) {
            await processMessage(sid, msg.message.text, client);
        } else if (msg.postback?.payload === 'START_BOOKING') {
            client.awaitingBooking = true; client.step = 1; saveDB(db);
            await fbAPI({ recipient: { id: sid }, message: { text: "تمام يا فندم، نبدأ بتسجيل طلبك. الاسم بالكامل؟" } });
        }
    }
    res.sendStatus(200);
});

app.listen(process.env.PORT || 3000, () => console.log("💎 ELAZ SUPREME AGENT IS ONLINE"));
