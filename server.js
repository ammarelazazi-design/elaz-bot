require('dotenv').config();
const express = require('express'), bodyParser = require('body-parser'), axios = require('axios');
const fs = require('fs'), path = require('path');
const app = express().use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN;
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
            stats: { totalMessages: 0, totalPostbacks: 0, serviceClicks: {}, appointments: [] }
        }));
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function getClient(db, sid) {
    if (!db.clients[sid]) {
        db.clients[sid] = { 
            sid, name: null, gender: null, lastService: null, 
            awaitingBooking: false, tempDetails: "" 
        };
    }
    return db.clients[sid];
}

// ============================================================
// 📡 FACEBOOK HELPERS
// ============================================================
async function sendTyping(sid) {
    try {
        await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            sender_action: "typing_on"
        });
    } catch (e) {
        console.error("Typing Error:", e.response?.data || e.message);
    }
}

async function sendMsg(sid, text) {
    try {
        await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            message: { text }
        });
    } catch (e) {
        console.error("SendMsg Error:", e.response?.data || e.message);
    }
}

async function sendButtons(sid, text, buttons) {
    try {
        await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "button",
                        text,
                        buttons
                    }
                }
            }
        });
    } catch (e) {
        console.error("Buttons Error:", e.response?.data || e.message);
    }
}

async function getUserProfile(sid) {
    try {
        const res = await axios.get(`https://graph.facebook.com/v21.0/${sid}?fields=name,gender&access_token=${PAGE_ACCESS_TOKEN}`);
        return res.data;
    } catch (e) {
        console.error("Profile Error:", e.response?.data || e.message);
        return { name: null, gender: null };
    }
}

// ============================================================
// 📲 BOOKING LOGIC
// ============================================================
async function startBooking(sid, client) {
    const db = loadDB();
    client.awaitingBooking = true;
    client.tempDetails = ""; 
    
    let question = "تمام يا فندم، ابعتلي تفاصيل طلبك واسمك ورقم التليفون.";

    if (client.lastService === 'SRV_DESIGN') {
        question = "قولي اسم البراند والألوان اللي بتحبها + رقمك.";
    } else if (client.lastService === 'SRV_ADS') {
        question = "قولي مجالك وهل جربت إعلانات قبل كده + رقمك.";
    } else if (client.lastService === 'SRV_BOTS') {
        question = "حابب البوت لخدمة العملاء ولا المبيعات؟ + رقمك.";
    }

    db.clients[sid] = client;
    saveDB(db);

    await sendTyping(sid); await sleep(600);
    await sendMsg(sid, question);
}

async function handleBookingData(sid, text, client) {
    const db = loadDB();
    const confirmWords = ["تمام", "ok", "ماشي", "موافق"];

    if (confirmWords.includes(text.toLowerCase().trim())) {

        const appointment = {
            sid,
            name: client.name || "عميل",
            service: client.lastService,
            details: client.tempDetails,
            time: new Date().toLocaleString('ar-EG')
        };

        if (GOOGLE_SHEET_URL) {
            try {
                await axios.post(GOOGLE_SHEET_URL, appointment);
            } catch (e) {
                console.error("Sheet Error:", e.message);
            }
        }

        client.awaitingBooking = false;
        client.tempDetails = "";

        db.stats.appointments.push(appointment);
        db.clients[sid] = client;
        saveDB(db);

        await sendMsg(sid, "تم الحجز ✅ هنكلمك قريب!");
        return;
    }

    client.tempDetails += (client.tempDetails ? " | " : "") + text;
    db.clients[sid] = client;
    saveDB(db);

    await sendMsg(sid, "سجلت 👍 عايز تضيف حاجة تانية؟ ولا كده تمام؟");
}

// ============================================================
// 🤖 SMART REPLY (Keyword Detection)
// ============================================================
function detectService(text) {
    text = text.toLowerCase();

    if (text.includes("لوجو") || text.includes("هوية")) return "SRV_DESIGN";
    if (text.includes("اعلان") || text.includes("ads")) return "SRV_ADS";
    if (text.includes("بوت")) return "SRV_BOTS";

    return null;
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
        if (messaging.message?.is_echo) continue;

        const db = loadDB();
        const client = getClient(db, sid);

        if (!client.name) {
            const profile = await getUserProfile(sid);
            client.name = profile.name;
            client.gender = profile.gender;
        }

        if (messaging.message?.text) {

            if (client.awaitingBooking) {
                await handleBookingData(sid, messaging.message.text, client);
                continue;
            }

            const detected = detectService(messaging.message.text);

            if (detected) {
                client.lastService = detected;
                db.clients[sid] = client;
                saveDB(db);

                await sendMsg(sid, "تمام فهمتك 👌 تحب تحجز استشارة؟");
                await sendButtons(sid, "اختار:", [
                    { type: "postback", title: "📅 احجز", payload: "BOOK_CONSULT" }
                ]);
                continue;
            }

            await sendMsg(sid, "أهلاً بك في ELAZ 👋");
            await sendButtons(sid, "اختار:", [
                { type: "postback", title: "📋 خدمات", payload: "SHOW_SERVICES" },
                { type: "postback", title: "📅 احجز", payload: "BOOK_CONSULT" },
                { type: "web_url", title: "واتساب", url: MY_WHATSAPP_LINK }
            ]);
        }

        if (messaging.postback) {
            const p = messaging.postback.payload;

            if (p === 'SHOW_SERVICES') {
                await sendButtons(sid, "خدماتنا:", [
                    { type: "postback", title: "🎨 تصميم", payload: "SRV_DESIGN" },
                    { type: "postback", title: "📢 إعلانات", payload: "SRV_ADS" },
                    { type: "postback", title: "🤖 بوت", payload: "SRV_BOTS" }
                ]);
            }

            else if (['SRV_DESIGN','SRV_ADS','SRV_BOTS'].includes(p)) {
                client.lastService = p;
                db.clients[sid] = client;
                saveDB(db);

                await sendButtons(sid, "تحب تحجز؟", [
                    { type: "postback", title: "📅 احجز", payload: "BOOK_CONSULT" }
                ]);
            }

            else if (p === 'BOOK_CONSULT') {
                await startBooking(sid, client);
            }
        }
    }

    res.sendStatus(200);
});

// VERIFY
app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.send(req.query['hub.challenge']);
    } else {
        res.send('Error');
    }
});

// START SERVER
app.listen(process.env.PORT || 3000, () => {
    console.log('✅ ELAZ Bot Live!');
});
