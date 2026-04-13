require('dotenv').config();
const express = require('express'), bodyParser = require('body-parser'), axios = require('axios');
const fs = require('fs'), path = require('path');
const app = express().use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN;
const CLAUDE_API_KEY    = process.env.CLAUDE_API_KEY;
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
    try { await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: sid }, sender_action: "typing_on" }); } catch (e) {}
}

async function sendMsg(sid, text) {
    try { await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: sid }, message: { text } }); } catch (e) {}
}

async function sendButtons(sid, text, buttons) {
    try { await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: sid }, message: { attachment: { type: "template", payload: { template_type: "button", text, buttons } } } }); } catch (e) {}
}

async function getUserProfile(sid) {
    try {
        const res = await axios.get(`https://graph.facebook.com/v21.0/${sid}?fields=name,gender&access_token=${PAGE_ACCESS_TOKEN}`);
        return res.data;
    } catch (e) { return { name: null, gender: null }; }
}

// ============================================================
// 📲 BOOKING LOGIC
// ============================================================
async function startBooking(sid, client) {
    const db = loadDB();
    client.awaitingBooking = true;
    client.tempDetails = ""; 
    
    let question = "تمام يا فندم، ابعتلي تفاصيل طلبك واسمك ورقم التليفون وهتواصل معاك فوراً.";
    
    if (client.lastService === 'SRV_DESIGN') {
        question = "جميل جداً بخصوص الهوية البصرية.. قولي اسم البراند إيه؟ وإيه الألوان اللي بتفضلها؟ (وابعت رقمك معاهم)";
    } else if (client.lastService === 'SRV_ADS') {
        question = "بخصوص الميديا باينج.. قولي إيه مجالك بالظبط؟ وهل جربت تعمل إعلانات قبل كدة؟ (وابعت رقمك معاهم)";
    } else if (client.lastService === 'SRV_BOTS') {
        question = "بخصوص البوت الذكي.. حابب يشتغل لخدمة العملاء ولا للمبيعات؟ (وابعت رقمك معاهم)";
    }

    db.clients[sid] = client;
    saveDB(db);
    await sendTyping(sid); await sleep(600);
    await sendMsg(sid, question);
}

async function handleBookingData(sid, text, client) {
    const db = loadDB();
    const triggerWords = ["تمام", "حسنا", "اوك", "ok", "okay", "ماشي", "موافق"];
    const lowercaseText = text.toLowerCase().trim();

    if (triggerWords.includes(lowercaseText)) {
        const serviceNames = { 'SRV_DESIGN': 'هوية بصرية', 'SRV_ADS': 'إعلانات ممولة', 'SRV_BOTS': 'بوت ذكي' };
        const appointment = {
            sid,
            name: client.name || "عميل",
            service: serviceNames[client.lastService] || "طلب عام",
            details: client.tempDetails || "تم التأكيد بدون تفاصيل إضافية",
            time: new Date().toLocaleString('ar-EG')
        };

        if (GOOGLE_SHEET_URL) {
            try {
                await axios.post(GOOGLE_SHEET_URL, {
                    name: appointment.name,
                    service: appointment.service,
                    details: appointment.details,
                    sid: appointment.sid
                });
            } catch (e) { console.error("Sheet Error"); }
        }

        client.awaitingBooking = false;
        client.tempDetails = ""; 
        db.clients[sid] = client;
        db.stats.appointments.push(appointment);
        saveDB(db);

        await sendTyping(sid); await sleep(800);
        await sendMsg(sid, "شكراً يا فندم على تعاملك معنا، ننتظرك المرة القادمة.. يومك سعيد! 😊");
        return;
    }

    client.tempDetails += (client.tempDetails ? " | " : "") + text;
    db.clients[sid] = client;
    saveDB(db);
    
    await sendTyping(sid); await sleep(600);
    await sendMsg(sid, "تمام يا فندم، سجلت التعديلات.. هل حابب تضيف أي حاجة تانية ولا كدة تمام؟");
}

// ============================================================
// 🔗 WEBHOOK & ROUTES
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
            client.name = profile.name || null;
            client.gender = profile.gender || 'male';
        }

        if (messaging.message?.text) {
            if (client.awaitingBooking) {
                await handleBookingData(sid, messaging.message.text, client);
            } else {
                await sendTyping(sid); await sleep(600);
                await sendMsg(sid, "أهلاً بك في ELAZ! تقدر تستعرض خدماتنا أو تحجز موعد مجاني.");
                await sendButtons(sid, "تحب تبدأ بإيه؟", [
                    { type: "postback", title: "📋 استعراض الخدمات", payload: "SHOW_SERVICES" },
                    { type: "postback", title: "📅 حجز موعد", payload: "BOOK_CONSULT" },
                    { type: "web_url",  title: "👤 واتساب",       url: MY_WHATSAPP_LINK }
                ]);
            }
        }

        if (messaging.postback) {
            const p = messaging.postback.payload;
            await sendTyping(sid);
            if (p === 'GET_STARTED' || p === 'SHOW_SERVICES') {
                await sendButtons(sid, `دي الخدمات اللي بنقدمها في ELAZ:`, [
                    { type: "postback", title: "🎨 هوية بصرية",    payload: "SRV_DESIGN" },
                    { type: "postback", title: "📢 إعلانات ممولة", payload: "SRV_ADS" },
                    { type: "postback", title: "🤖 بوتات ذكية",    payload: "SRV_BOTS" }
                ]);
            } else if (['SRV_DESIGN', 'SRV_ADS', 'SRV_BOTS'].includes(p)) {
                client.lastService = p;
                db.clients[sid] = client;
                saveDB(db);
                const msgs = {
                    'SRV_DESIGN': "🎨 بنصمم لوجو وهوية بصرية كاملة تخلي البراند بتاعك في حتة تانية.",
                    'SRV_ADS': "📢 بنعمل حملات إعلانية احترافية بتستهدف جمهورك الصح عشان نزود مبيعاتك.",
                    'SRV_BOTS': "🤖 بنعملك بوت ذكي يرد على عملائك 24 ساعة ويوفر عليك مجهود كبير."
                };
                await sendMsg(sid, msgs[p]);
                await sleep(500);
                await sendButtons(sid, "تحب تحجز استشارة مجانية بخصوص الخدمة دي؟", [
                    { type: "postback", title: "📅 حجز موعد", payload: "BOOK_CONSULT" },
                    { type: "postback", title: "📋 خدمات تانية", payload: "SHOW_SERVICES" }
                ]);
            } else if (p === 'BOOK_CONSULT') {
                await startBooking(sid, client);
            }
        }
    }
    res.sendStatus(200);
});

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.send(req.query['hub.challenge']);
    else res.send('Error');
});

app.listen(process.env.PORT || 3000, () => console.log('✅ ELAZ Bot Live!'));
