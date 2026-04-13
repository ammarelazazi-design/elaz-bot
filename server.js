require('dotenv').config();
const express = require('express'), bodyParser = require('body-parser'), axios = require('axios');
const fs = require('fs'), path = require('path');
const app = express().use(bodyParser.json());

const { PAGE_ACCESS_TOKEN, VERIFY_TOKEN, OPENROUTER_API_KEY, GOOGLE_SHEET_URL } = process.env;
const MY_WHATSAPP_LINK = "https://wa.me/201557963125";
const DB_FILE = path.join(__dirname, 'db.json');

// ============================================================
// 📊 ADVANCED DATABASE (Tracking & Analytics)
// ============================================================
const loadDB = () => JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const saveDB = (db) => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

// ============================================================
// 🧠 THE "BRAIN" - AI STRATEGIST
// ============================================================
async function askAI(message, history = []) {
    try {
        const res = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            model: "openai/gpt-3.5-turbo",
            messages: [
                { 
                    role: "system", 
                    content: `أنت مساعد مبيعات تنفيذي لوكالة ELAZ. لغتك هي مزيج بين الاحترافية العالمية والروح المصرية الذكية.
                    مهمتك: 
                    1. الرد على استفسارات الخدمات (هوية بصرية، إعلانات، بوتات) فقط.
                    2. إبهار العميل بمعلومات قيمة (مثلاً: أهمية الهوية البصرية في زيادة الثقة).
                    3. تصنيف العميل ودفعه للحجز بلباقة.
                    4. إذا سأل عن شيء تافه، اعتذر بلباقة وقل أنك مخصص لنمو الأعمال فقط.` 
                },
                ...history,
                { role: "user", content: message }
            ]
        }, { headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}` } });
        return res.data.choices[0].message.content;
    } catch (e) { return "أهلاً بك في ELAZ. نحن نبني مستقبل أعمالك. كيف نساعدك اليوم؟"; }
}

// ============================================================
// 🎨 THE PREMIER VISUAL SYSTEM (إبهار بصري)
// ============================================================
const fbAPI = (data) => axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, data);

async function sendVisualPortfolio(sid) {
    const data = {
        recipient: { id: sid },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "generic",
                    image_aspect_ratio: "square", 
                    elements: [
                        {
                            title: "🚀 نمو المبيعات (Media Buying)",
                            image_url: "https://images.unsplash.com/photo-1551288049-bb14832970fd?w=600",
                            subtitle: "نحول ميزانيتك الإعلانية لأرقام مبيعات حقيقية.",
                            buttons: [{ type: "postback", title: "استشارة مجانية", payload: "START_BOOKING" }]
                        },
                        {
                            title: "💎 هويات بصرية (Branding)",
                            image_url: "https://images.unsplash.com/photo-1561070791-26c11d6996ad?w=600",
                            subtitle: "نصمم لوجو يعيش سنين ويبني ثقة مع جمهورك.",
                            buttons: [{ type: "postback", title: "ابدأ تصميمك", payload: "START_BOOKING" }]
                        },
                        {
                            title: "🤖 أنظمة AI (Automation)",
                            image_url: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=600",
                            subtitle: "بوتات ذكية ترد وتبيع مكانك 24/7.",
                            buttons: [{ type: "postback", title: "امتلك بوتك", payload: "START_BOOKING" }]
                        }
                    ]
                }
            }
        }
    };
    await fbAPI(data);
}

// ============================================================
// 📲 ELITE BOOKING ENGINE (خطوات مدروسة)
// ============================================================
async function handleFlow(sid, text, client) {
    const db = loadDB();
    
    if (client.step === 1) { // الاسم
        client.name = text; client.step = 2; saveDB(db);
        await fbAPI({ recipient: { id: sid }, message: { text: `تشرفنا يا أستاذ ${text}! ✨\nممكن نبذة سريعة عن مشروعك؟ (عشان نجهزلك عرض مناسب)` } });
    } 
    else if (client.step === 2) { // التفاصيل
        client.details = text; client.step = 3; saveDB(db);
        const aiAnalysis = await askAI(text, [{role: "system", content: "العميل يشرح مشروعه. رد عليه برد احترافي جداً يثبت خبرة الوكالة ثم اطلب رقم الواتساب."}]);
        await fbAPI({ recipient: { id: sid }, message: { text: aiAnalysis } });
        await fbAPI({ recipient: { id: sid }, message: { text: "أخر حاجة، رقم الواتساب للتواصل الرسمي؟ 📞" } });
    } 
    else if (client.step === 3) { // الإغلاق
        client.phone = text;
        const appt = { name: client.name, details: client.details, phone: client.phone, time: new Date().toLocaleString('ar-EG') };
        if (GOOGLE_SHEET_URL) try { await axios.post(GOOGLE_SHEET_URL, appt); } catch(e){}
        
        db.stats.appointments.push(appt);
        client.awaitingBooking = false; client.step = 0; saveDB(db);

        await fbAPI({ recipient: { id: sid }, message: { text: "تم تسجيل طلبك بنجاح. فريقنا هيراجع التفاصيل وهنتصل بحضرتك فوراً. 🤝" } });
        await fbAPI({
            recipient: { id: sid },
            message: { 
                attachment: { 
                    type: "template", 
                    payload: { 
                        template_type: "button", 
                        text: "لو حابب تبدأ الدردشة فوراً مع المدير التنفيذي:", 
                        buttons: [{ type: "web_url", title: "واتساب مباشر 🟢", url: MY_WHATSAPP_LINK }] 
                    } 
                } 
            }
        });
    }
}

// ============================================================
// 🔗 WEBHOOK (The Command Center)
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
            const txt = msg.message.text;
            if (client.awaitingBooking) {
                await handleFlow(sid, txt, client);
            } else {
                const aiReply = await askAI(txt);
                await fbAPI({ recipient: { id: sid }, message: { text: aiReply } });
                await sendVisualPortfolio(sid);
            }
        }

        if (msg.postback) {
            if (msg.postback.payload === 'START_BOOKING') {
                client.awaitingBooking = true; client.step = 1; saveDB(db);
                await fbAPI({ recipient: { id: sid }, message: { text: "ممتاز! نبدأ بتسجيل البيانات.. الاسم بالكامل؟ 😊" } });
            }
        }
    }
    res.sendStatus(200);
});

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.send(req.query['hub.challenge']);
    else res.send('Error');
});

app.listen(process.env.PORT || 3000, () => console.log("🚀 ELAZ PREMIER AGENT LIVE"));
