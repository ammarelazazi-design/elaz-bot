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

// --- DATABASE ---
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
        db.clients[sid] = { sid, name: null, gender: null, services: [], appointments: [], awaitingBooking: false };
    }
    return db.clients[sid];
}

// --- FB HELPERS ---
async function sendMsg(sid, text) {
    try { await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: sid }, message: { text } }); } catch (e) {}
}
async function sendButtons(sid, text, buttons) {
    try { await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: sid }, message: { attachment: { type: "template", payload: { template_type: "button", text, buttons } } } }); } catch (e) {}
}
async function sendTyping(sid) {
    try { await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: sid }, sender_action: "typing_on" }); } catch (e) {}
}

// --- MENUS ---
async function sendWelcome(sid, client) {
    const greeting = client.gender === 'female' ? 'يا هانم' : 'يا فندم';
    await sendButtons(sid, `أهلاً بك في وكالة ELAZ للتسويق والتصميم 🎯\nتحب تبدأ بإيه؟`, [
        { type: "postback", title: "📋 استعراض الخدمات", payload: "SHOW_SERVICES" },
        { type: "web_url",  title: "👤 خدمة العملاء",    url: MY_WHATSAPP_LINK }
    ]);
}

async function sendServicesMenu(sid) {
    await sendButtons(sid, `اتفضل، دي الخدمات اللي بنقدمها في ELAZ:`, [
        { type: "postback", title: "🎨 هوية بصرية",    payload: "SRV_DESIGN" },
        { type: "postback", title: "📢 إعلانات ممولة", payload: "SRV_ADS" },
        { type: "postback", title: "🤖 بوتات ذكية",    payload: "SRV_BOTS" }
    ]);
}

async function sendServiceDetail(sid, service) {
    const msgs = {
        SRV_DESIGN: "🎨 بنقدم تصميم لوجو، هوية بصرية كاملة، وتصاميم سوشيال ميديا باحترافية.",
        SRV_ADS:    "📢 بنعمل حملات إعلانية على فيسبوك وإنستجرام وتيك توك بهدف تحقيق أعلى مبيعات.",
        SRV_BOTS:   "🤖 بنصمم بوتات ذكية لردود تلقائية وتوفير وقتك وزيادة مبيعاتك."
    };
    await sendMsg(sid, msgs[service]);
    await sleep(500);
    await sendButtons(sid, "تحب تحجز استشارة مجانية؟", [
        { type: "postback", title: "📅 حجز موعد", payload: "BOOK_CONSULT" },
        { type: "postback", title: "📋 خدمات تانية", payload: "SHOW_SERVICES" }
    ]);
}

async function handleBookingData(sid, text, client) {
    const db = loadDB();
    const appointment = { sid, name: client.name, data: text, time: new Date().toLocaleString('ar-EG') };
    db.stats.appointments.push(appointment);
    client.awaitingBooking = false;
    db.clients[sid] = client;
    saveDB(db);

    if (GOOGLE_SHEET_URL) {
        try { await axios.post(GOOGLE_SHEET_URL, { name: appointment.name, details: appointment.data, sid: appointment.sid }); } catch (e) {}
    }
    await sendMsg(sid, "✅ تم استلام بياناتك! فريق ELAZ هيتواصل معاك فوراً.");
}

// --- WEBHOOK ---
app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.send(req.query['hub.challenge']);
    else res.send('Error');
});

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object !== 'page') return res.sendStatus(404);

    for (let entry of body.entry) {
        const messaging = entry.messaging[0];
        const sid = messaging.sender.id;
        const db = loadDB();
        const client = getClient(db, sid);

        if (messaging.message?.text) {
            db.stats.totalMessages++;
            saveDB(db);
            if (client.awaitingBooking) {
                await handleBookingData(sid, messaging.message.text, client);
            } else {
                await sendMsg(sid, "أهلاً بك في ELAZ! لو حابب تشوف خدماتنا دوس على زرار الخدمات.");
                await sendWelcome(sid, client);
            }
        }

        if (messaging.postback) {
            db.stats.totalPostbacks++;
            saveDB(db);
            const p = messaging.postback.payload;
            if (p === 'GET_STARTED') await sendWelcome(sid, client);
            else if (p === 'SHOW_SERVICES') await sendServicesMenu(sid);
            else if (['SRV_DESIGN','SRV_ADS','SRV_BOTS'].includes(p)) await sendServiceDetail(sid, p);
            else if (p === 'BOOK_CONSULT') {
                client.awaitingBooking = true;
                db.clients[sid] = client;
                saveDB(db);
                await sendMsg(sid, "اكتب اسمك:
                              ورقم تلفونك:📅");
            }
        }
    }
    res.sendStatus(200);
});

app.get('/stats', (req, res) => res.json(loadDB().stats));
app.listen(process.env.PORT || 3000);
