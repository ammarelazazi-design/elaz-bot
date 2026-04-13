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
            sid, name: null, gender: null, lastService: null, 
            awaitingBooking: false, tempDetails: "" 
        };
    }
    return db.clients[sid];
}

// ============================================================
// 🤖 AI
// ============================================================
async function askAI(message) {
    try {
        const res = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            model: "openai/gpt-3.5-turbo",
            messages: [
                {
                    role: "system",
                    content: `
أنت مساعد لشركة ELAZ.
تتكلم بالمصري.
ترد فقط في نطاق:
- تصميم لوجو وهوية بصرية
- إعلانات ممولة
- بوتات ذكية

هدفك تقنع العميل يحجز استشارة.
ممنوع تخرج برا المجال ده.
                    `
                },
                { role: "user", content: message }
            ]
        }, {
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            }
        });

        return res.data.choices[0].message.content;

    } catch (e) {
        console.error("AI Error:", e.response?.data || e.message);
        return "حصل مشكلة بسيطة.. وضحلي أكتر 🙏";
    }
}

// ============================================================
// 📡 FACEBOOK
// ============================================================
async function sendTyping(sid) {
    try {
        await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            sender_action: "typing_on"
        });
    } catch (e) {}
}

async function sendMsg(sid, text) {
    try {
        await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            message: { text }
        });
    } catch (e) {
        console.error("Send Error:", e.response?.data || e.message);
    }
}

async function sendButtons(sid, text, buttons) {
    try {
        await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            message: {
                attachment: {
                    type: "template",
                    payload: { template_type: "button", text, buttons }
                }
            }
        });
    } catch (e) {}
}

// ============================================================
// 📲 BOOKING
// ============================================================
async function startBooking(sid, client) {
    const db = loadDB();
    client.awaitingBooking = true;
    client.tempDetails = "";

    db.clients[sid] = client;
    saveDB(db);

    await sendMsg(sid, "ابعت اسمك + رقمك + تفاصيل طلبك 🙌");
}

async function handleBookingData(sid, text, client) {
    const db = loadDB();

    if (["تمام","ok","ماشي"].includes(text.toLowerCase())) {

        const appointment = {
            name: client.name || "عميل",
            service: client.lastService,
            details: client.tempDetails,
            time: new Date().toLocaleString('ar-EG')
        };

        if (GOOGLE_SHEET_URL) {
            await axios.post(GOOGLE_SHEET_URL, appointment);
        }

        client.awaitingBooking = false;
        client.tempDetails = "";

        db.stats.appointments.push(appointment);
        saveDB(db);

        await sendMsg(sid, "تم الحجز ✅ هنكلمك قريب!");
        return;
    }

    client.tempDetails += " | " + text;
    saveDB(db);

    await sendMsg(sid, "سجلت 👍 كمل أو قول تمام");
}

// ============================================================
// 🔗 WEBHOOK
// ============================================================
app.post('/webhook', async (req, res) => {
    const body = req.body;

    for (let entry of body.entry) {
        const messaging = entry.messaging[0];
        const sid = messaging.sender.id;

        const db = loadDB();
        const client = getClient(db, sid);

        if (messaging.message?.text) {

            if (client.awaitingBooking) {
                await handleBookingData(sid, messaging.message.text, client);
                continue;
            }

            await sendTyping(sid);
            await sleep(600);

            const aiReply = await askAI(messaging.message.text);
            await sendMsg(sid, aiReply);

            await sendButtons(sid, "تحب تحجز؟", [
                { type: "postback", title: "📅 احجز", payload: "BOOK" }
            ]);
        }

        if (messaging.postback) {
            if (messaging.postback.payload === "BOOK") {
                await startBooking(sid, client);
            }
        }
    }

    res.sendStatus(200);
});

// ============================================================
// 📊 DASHBOARD (Bootstrap)
// ============================================================
app.get('/dashboard', (req, res) => {
    const db = loadDB();

    res.send(`
    <html>
    <head>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <style>body{background:#0f172a;color:white}</style>
    </head>
    <body class="p-4">

    <h1>🚀 ELAZ Dashboard</h1>

    <div class="row my-4">
        <div class="col">
            <div class="card p-3 bg-dark">
                👥 Clients: ${Object.keys(db.clients).length}
            </div>
        </div>
        <div class="col">
            <div class="card p-3 bg-dark">
                📅 Appointments: ${db.stats.appointments.length}
            </div>
        </div>
    </div>

    <h3>📅 الحجوزات</h3>
    <table class="table table-dark">
        <tr><th>الاسم</th><th>الخدمة</th><th>التفاصيل</th></tr>
        ${db.stats.appointments.map(a => `
            <tr>
                <td>${a.name}</td>
                <td>${a.service}</td>
                <td>${a.details}</td>
            </tr>
        `).join('')}
    </table>

    </body>
    </html>
    `);
});

// ============================================================
// VERIFY + SERVER
// ============================================================
app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN)
        res.send(req.query['hub.challenge']);
    else res.send('Error');
});

app.listen(3000, () => console.log("🔥 ELAZ Bot Live"));
