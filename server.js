require('dotenv').config();
const express = require('express'), bodyParser = require('body-parser'), axios = require('axios');
const fs = require('fs'), path = require('path');
const app = express().use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN;
const OPENROUTER_API_KEY= process.env.OPENROUTER_API_KEY;
const GOOGLE_SHEET_URL  = process.env.GOOGLE_SHEET_URL; 
const MY_WHATSAPP_LINK  = "https://wa.me/201557963125";

const sleep = (ms) => new Promise(res => setTimeout(res, ms));
const DB_FILE = path.join(__dirname, 'db.json');

// ============================================================
// 💾 DATABASE
// ============================================================
function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({
            clients: {},
            stats: { appointments: [] }
        }));
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function getClient(db, sid) {
    if (!db.clients[sid]) {
        db.clients[sid] = { 
            sid, name: null, phone: null, service: null, details: null,
            step: 0, awaitingBooking: false 
        };
    }
    return db.clients[sid];
}

// ============================================================
// 🤖 AI & FACEBOOK HELPERS
// ============================================================
async function sendTyping(sid) {
    try { await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: sid }, sender_action: "typing_on" }); } catch (e) {}
}

async function sendMsg(sid, text) {
    try { await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: sid }, message: { text } }); } catch (e) {}
}

async function sendButtons(sid, text, buttons) {
    try { await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: sid }, message: { attachment: { type: "template", payload: { template_type: "button", text, buttons } } } }); } catch (e) {}
}

// ============================================================
// 📲 SMART BOOKING FLOW (Step-by-Step)
// ============================================================
async function handleBookingFlow(sid, text, client) {
    const db = loadDB();
    client.awaitingBooking = true;

    // الخطوة 0: اختيار الخدمة (لو مكنش اختارها من الأزرار)
    if (client.step === 0) {
        await sendButtons(sid, "يا أهلاً بيك! حابب تستفسر عن انهي خدمة بالظبط؟ ✨", [
            { type: "postback", title: "🎨 هوية بصرية", payload: "SET_SRV_DESIGN" },
            { type: "postback", title: "📢 إعلانات ممولة", payload: "SET_SRV_ADS" },
            { type: "postback", title: "🤖 بوتات ذكية", payload: "SET_SRV_BOTS" }
        ]);
        return;
    }

    // الخطوة 1: طلب الاسم
    if (client.step === 1) {
        await sendMsg(sid, "تشرفنا يا فندم! ممكن أعرف اسم حضرتك بالكامل؟ 😊");
        client.step = 2;
        saveDB(db);
        return;
    }

    // الخطوة 2: استقبال الاسم وطلب التفاصيل
    if (client.step === 2) {
        client.name = text;
        await sendMsg(sid, `أهلاً بك يا أستاذ ${text}.. ممكن تقولي تفاصيل طلبك إيه بالظبط؟ (مثلاً: نوع مجالك أو هدفك من الخدمة)`);
        client.step = 3;
        saveDB(db);
        return;
    }

    // الخطوة 3: استقبال التفاصيل وطلب الرقم
    if (client.step === 3) {
        client.details = text;
        await sendMsg(sid, "تمام جداً.. آخر حاجة محتاجين رقم تليفون حضرتك عشان نتواصل معاك فوراً 📞");
        client.step = 4;
        saveDB(db);
        return;
    }

    // الخطوة 4: استقبال الرقم والإنهاء
    if (client.step === 4) {
        client.phone = text;
        
        const appointment = {
            name: client.name,
            service: client.service || "غير محدد",
            details: client.details,
            phone: client.phone,
            time: new Date().toLocaleString('ar-EG')
        };

        // إرسال لجوجل شيت
        if (GOOGLE_SHEET_URL) {
            try { await axios.post(GOOGLE_SHEET_URL, appointment); } catch (e) { console.error("Sheet Error"); }
        }

        // حفظ في الـ DB
        db.stats.appointments.push(appointment);
        
        // إعادة تصفير العميل
        client.awaitingBooking = false;
        client.step = 0;
        db.clients[sid] = client;
        saveDB(db);

        await sendMsg(sid, "تمام يا فندم، سجلت بياناتك وان شاء الله فريق ELAZ هيتواصل معك في أسرع وقت ممكن! ⚡");
        await sleep(1000);
        await sendButtons(sid, "لو حابب تتواصل معانا مباشرة دلوقتي تقدر تكلمنا واتساب من هنا:", [
            { type: "web_url", title: "👤 واتساب مباشر", url: MY_WHATSAPP_LINK }
        ]);
        await sendMsg(sid, "شكراً لثقتك في ELAZ، ننتظرك المرة القادمة.. يومك سعيد! 🌸");
    }
}

// ============================================================
// 🔗 WEBHOOK
// ============================================================
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object !== 'page') return res.sendStatus(404);

    for (let entry of body.entry) {
        const messaging = entry.messaging[0];
        if (!messaging) continue;
        const sid = messaging.sender.id;

        const db = loadDB();
        const client = getClient(db, sid);

        // التعامل مع الرسائل النصية
        if (messaging.message?.text) {
            if (client.awaitingBooking) {
                await handleBookingFlow(sid, messaging.message.text, client);
            } else {
                await sendTyping(sid); await sleep(800);
                await sendButtons(sid, "أهلاً بك في ELAZ! 🚀\nتقدر تختار الخدمة اللي محتاجها من الأزرار تحت أو تحجز استشارة مباشرة.", [
                    { type: "postback", title: "📋 خدماتنا", payload: "SHOW_SERVICES" },
                    { type: "postback", title: "📅 حجز موعد", payload: "START_BOOKING" }
                ]);
            }
        }

        // التعامل مع الأزرار (Postback)
        if (messaging.postback) {
            const p = messaging.postback.payload;

            if (p === 'START_BOOKING') {
                client.step = 1;
                await handleBookingFlow(sid, "", client);
            } else if (p === 'SHOW_SERVICES') {
                await sendButtons(sid, "دي الخدمات اللي بنقدمها حالياً:", [
                    { type: "postback", title: "🎨 هوية بصرية", payload: "SET_SRV_DESIGN" },
                    { type: "postback", title: "📢 إعلانات ممولة", payload: "SET_SRV_ADS" },
                    { type: "postback", title: "🤖 بوتات ذكية", payload: "SET_SRV_BOTS" }
                ]);
            } else if (p.startsWith('SET_SRV_')) {
                const srvMap = { 'SET_SRV_DESIGN': 'تصميم هوية', 'SET_SRV_ADS': 'ميديا باينج', 'SET_SRV_BOTS': 'بوتات ذكية' };
                client.service = srvMap[p];
                client.step = 1;
                db.clients[sid] = client;
                saveDB(db);
                await handleBookingFlow(sid, "", client);
            }
        }
    }
    res.sendStatus(200);
});

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.send(req.query['hub.challenge']);
    else res.send('Error');
});

app.listen(3000, () => console.log("🔥 ELAZ Bot Live"));
