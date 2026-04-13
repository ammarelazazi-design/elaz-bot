require('dotenv').config();
const express = require('express'), bodyParser = require('body-parser'), axios = require('axios');
const fs = require('fs'), path = require('path');
const app = express().use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN;
const CLAUDE_API_KEY    = process.env.CLAUDE_API_KEY;
const GOOGLE_SHEET_URL  = process.env.GOOGLE_SHEET_URL; // الرابط اللي ضفته في Render
const MY_WHATSAPP_LINK  = "https://wa.me/201557963125";
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

const DB_FILE = path.join(__dirname, 'db.json');

// ============================================================
// 💾 DATABASE FUNCTIONS
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

function saveDB(db) {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function getClient(db, sid) {
    if (!db.clients[sid]) {
        db.clients[sid] = {
            sid, name: null, gender: null,
            msgCount: 0, services: [], appointments: [],
            awaitingBooking: false
        };
    }
    return db.clients[sid];
}

// ============================================================
// 📡 FACEBOOK API HELPERS
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
// 🧠 AI ENGINE
// ============================================================
async function getAIReply(userText, gender, clientName) {
    const SYSTEM_PROMPT = `أنت مساعد ذكي لوكالة ELAZ للتسويق. ردودك قصيرة، محترفة، وبلغة مصرية مهذبة. خاطب العميل بـ يا فندم أو يا هانم.`;
    try {
        const res = await axios.post('https://api.anthropic.com/v1/messages', {
            model: 'claude-3-5-sonnet-20240620',
            max_tokens: 200,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: userText }]
        }, { headers: { 'x-api-key': CLAUDE_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } });
        return res.data.content[0].text;
    } catch (e) { return "أهلاً بك في ELAZ! حابب تعرف أكتر عن خدماتنا في الإعلانات أو التصميم؟"; }
}

// ============================================================
// 📲 FLOWS & BOOKING
// ============================================================
async function sendWelcome(sid, client) {
    const greeting = client.gender === 'female' ? 'يا هانم' : 'يا فندم';
    await sendButtons(sid, `أهلاً بك ${client.name || ''} ${greeting} في وكالة ELAZ للتسويق والتصميم 🎯`, [
        { type: "postback", title: "📋 استعراض الخدمات", payload: "SHOW_SERVICES" },
        { type: "web_url",  title: "👤 خدمة العملاء",    url: MY_WHATSAPP_LINK }
    ]);
}

async function handleBookingData(sid, text, client) {
    const db = loadDB();
    const appointment = { sid, name: client.name, data: text, time: new Date().toLocaleString('ar-EG') };
    
    // حفظ محلي
    db.stats.appointments.push(appointment);
    client.awaitingBooking = false;
    db.clients[sid] = client;
    saveDB(db);

    // 🔥 إرسال لجوجل شيت (الرابط من Render)
    try {
        if (GOOGLE_SHEET_URL) {
            await axios.post(GOOGLE_SHEET_URL, { name: appointment.name, details: appointment.data, sid: appointment.sid });
            console.log("✅ Data sent to Google Sheets");
        }
    } catch (error) { console.error("❌ Google Sheets Error:", error.message); }

    await sendMsg(sid, "✅ تم استلام بياناتك! فريق ELAZ هيتواصل معاك فوراً.");
}

// ============================================================
// 🔗 WEBHOOK & ROUTES
// ============================================================
app.get('/stats', (req, res) => {
    const db = loadDB();
    res.json({
        totalClients: Object.keys(db.clients).length,
        totalMessages: db.stats.totalMessages,
        totalPostbacks: db.stats.totalPostbacks,
        appointments: db.stats.appointments.length,
        lastAppointments: db.stats.appointments.slice(-5)
    });
});

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
        if (messaging.message?.is_echo) continue;

        const db = loadDB();
        const client = getClient(db, sid);

        if (!client.name) {
            const profile = await getUserProfile(sid);
            client.name = profile.name;
            client.gender = profile.gender || 'male';
        }

        // ── رسالة نصية ──
        if (messaging.message?.text) {
            db.stats.totalMessages++;
            saveDB(db);
            const text = messaging.message.text;

            if (client.awaitingBooking) {
                await handleBookingData(sid, text, client);
            } else {
                await sendTyping(sid);
                const aiReply = await getAIReply(text, client.gender, client.name);
                await sendMsg(sid, aiReply);
            }
        }

        // ── Postback ──
        if (messaging.postback) {
            db.stats.totalPostbacks++;
            saveDB(db);
            const p = messaging.postback.payload;
            if (p === 'GET_STARTED') await sendWelcome(sid, client);
            if (p === 'BOOK_CONSULT') {
                client.awaitingBooking = true;
                db.clients[sid] = client;
                saveDB(db);
                await sendMsg(sid, "ابعتلي اسمك ورقم تليفونك وهنتواصل معاك فوراً 📅");
            }
        }
    }
    res.sendStatus(200);
});

app.listen(process.env.PORT || 3000, () => console.log('✅ ELAZ Bot is Ready!'));
