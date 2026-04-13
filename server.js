require('dotenv').config();
const express = require('express'), bodyParser = require('body-parser'), axios = require('axios');
const fs = require('fs'), path = require('path');
const app = express().use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN;
const CLAUDE_API_KEY    = process.env.CLAUDE_API_KEY;
const GOOGLE_SHEET_URL  = process.env.GOOGLE_SHEET_URL; // المتغير الذي أضفته في Render
const MY_WHATSAPP_LINK  = "https://wa.me/201557963125";
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

// ============================================================
// 💾 JSON DATABASE
// ============================================================
const DB_FILE = path.join(__dirname, 'db.json');

function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({
            clients: {},
            stats: { totalMessages: 0, totalPostbacks: 0, serviceClicks: {}, appointments: [] },
            broadcast: []
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
            firstSeen: new Date().toISOString(),
            lastSeen: null, msgCount: 0,
            services: [], appointments: [],
            awaitingBooking: false
        };
    }
    return db.clients[sid];
}

// ============================================================
// 📡 FACEBOOK API HELPERS
// ============================================================
async function sendTyping(sid) {
    try {
        await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            { recipient: { id: sid }, sender_action: "typing_on" });
    } catch (e) {}
}

async function sendMsg(sid, text) {
    try {
        await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            { recipient: { id: sid }, message: { text } });
    } catch (e) {}
}

async function sendButtons(sid, text, buttons) {
    try {
        await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            { recipient: { id: sid }, message: { attachment: { type: "template", payload: { template_type: "button", text, buttons } } } });
    } catch (e) {}
}

async function sendImage(sid, imageUrl) {
    try {
        await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            { recipient: { id: sid }, message: { attachment: { type: "image", payload: { url: imageUrl, is_reusable: true } } } });
    } catch (e) {}
}

async function getUserProfile(sid) {
    try {
        const res = await axios.get(`https://graph.facebook.com/v21.0/${sid}?fields=name,gender&access_token=${PAGE_ACCESS_TOKEN}`);
        return res.data;
    } catch (e) { return { name: null, gender: null }; }
}

// ============================================================
// 🧠 AI REPLY (Claude AI)
// ============================================================
const SYSTEM_PROMPT = `أنت مساعد ذكي لوكالة ELAZ للتسويق والتصميم.
مهمتك الوحيدة هي مساعدة العملاء في الاستفسار عن خدمات الوكالة فقط وهي:
- الهوية البصرية (لوجو، تصاميم سوشيال ميديا)
- الإعلانات الممولة (فيسبوك، إنستجرام، تيك توك)
- البوتات الذكية
قواعد صارمة:
1. لا تتكلم في أي موضوع خارج نطاق الوكالة.
2. خاطب الذكر بـ يا فندم والأنثى بـ يا هانم.
3. الردود قصيرة ومباشرة.
4. لا تعِد بأسعار محددة.`;

async function getAIReply(userText, gender, clientName) {
    try {
        const genderNote = gender === 'female' ? `العميلة اسمها ${clientName || 'هانم'}، خاطبيها بـ يا هانم.` : `العميل اسمه ${clientName || 'فندم'}، خاطبه بـ يا فندم.`;
        const res = await axios.post('https://api.anthropic.com/v1/messages', {
            model: 'claude-3-5-sonnet-20240620',
            max_tokens: 300,
            system: SYSTEM_PROMPT + '\n' + genderNote,
            messages: [{ role: "user", content: userText }]
        }, {
            headers: {
                'x-api-key': CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            }
        });
        return res.data.content[0].text;
    } catch (e) {
        return "مرحبا بك في ELAZ نحن سعداء بتعاملك معنا، اتفضل يا فندم حابب تعرف إيه؟";
    }
}

// ============================================================
// 📲 MENUS & FLOWS
// ============================================================
async function sendWelcome(sid, client) {
    const greeting = client.gender === 'female' ? 'يا هانم' : 'يا فندم';
    const name = client.name ? ` ${client.name}` : '';
    await sendButtons(sid,
        `أهلاً بك${name} ${greeting} في وكالة ELAZ للتسويق والتصميم 🎯\nتحب تبدأ بإيه؟`,
        [
            { type: "postback", title: "📋 استعراض الخدمات", payload: "SHOW_SERVICES" },
            { type: "web_url",  title: "👤 خدمة العملاء",    url: MY_WHATSAPP_LINK }
        ]
    );
}

async function sendServicesMenu(sid) {
    await sendButtons(sid, `اتفضل، دي الخدمات اللي بنقدمها في ELAZ:`, [
        { type: "postback", title: "🎨 هوية بصرية",    payload: "SRV_DESIGN" },
        { type: "postback", title: "📢 إعلانات ممولة", payload: "SRV_ADS" },
        { type: "postback", title: "🤖 بوتات ذكية",    payload: "SRV_BOTS" }
    ]);
}

async function sendContactButtons(sid) {
    await sendButtons(sid, "تحب تتواصل معنا أو تحجز استشارة مجانية؟", [
        { type: "web_url",  title: "👤 واتساب",        url: MY_WHATSAPP_LINK },
        { type: "postback", title: "📅 حجز ",   payload: "BOOK_CONSULT" },
        { type: "postback", title: "📋 عرض الخدمات",   payload: "SHOW_SERVICES" }
    ]);
}

async function sendServiceDetail(sid, service, client) {
    const msgs = {
        SRV_DESIGN: "🎨 بنقدم تصميم لوجو، هوية بصرية كاملة، وتصاميم سوشيال ميديا باحترافية.\nالأسعار بتتحدد بعد الاستشارة حسب احتياجك.",
        SRV_ADS:    "📢 بنعمل حملات إعلانية على فيسبوك وإنستجرام وتيك توك بهدف تحقيق أعلى مبيعات.\nبنبدأ بتحليل جمهورك الأول.",
        SRV_BOTS:   "🤖 بنصمم بوتات ذكية لردود تلقائية وتوفير وقتك وزيادة مبيعاتك.\nزي البوت اللي بتكلمه دلوقتي 😄"
    };
    await sendMsg(sid, msgs[service]);
    await sleep(400);
    await sendContactButtons(sid);

    const db = loadDB();
    db.stats.serviceClicks[service] = (db.stats.serviceClicks[service] || 0) + 1;
    if (!client.services.includes(service)) client.services.push(service);
    db.clients[sid] = client;
    saveDB(db);
}

async function startBooking(sid, client) {
    const greeting = client.gender === 'female' ? 'يا هانم' : 'يا فندم';
    await sendMsg(sid, `تمام ${greeting} 📅\nابعتلي اسمك ورقم تليفونك وهنتواصل معاك لتحديد موعد الاستشارة المجانية.`);
    const db = loadDB();
    client.awaitingBooking = true;
    db.clients[sid] = client;
    saveDB(db);
}

async function handleBookingData(sid, text, client) {
    const db = loadDB();
    const appointment = { 
        sid, 
        name: client.name || "عميل غير معروف", 
        data: text, 
        time: new Date().toLocaleString('ar-EG') 
    };
    
    db.stats.appointments.push(appointment);
    client.appointments.push(appointment);
    client.awaitingBooking = false;
    db.clients[sid] = client;
    saveDB(db);

    // 🔥 الإرسال لـ Google Sheets
    if (GOOGLE_SHEET_URL) {
        try {
            await axios.post(GOOGLE_SHEET_URL, {
                name: appointment.name,
                details: appointment.data,
                sid: appointment.sid
            });
            console.log("✅ Data sent to Google Sheets");
        } catch (e) {
            console.error("❌ Google Sheets Error:", e.message);
        }
    }

    await sendMsg(sid, "✅ تم استلام بياناتك! هيتواصل معاك فريقنا خلال 24 ساعة لتأكيد الموعد ");
    await sleep(400);
    await sendButtons(sid, "في حاجة تانية أقدر أساعدك بيها؟", [
        { type: "postback", title: "📋 عرض الخدمات", payload: "SHOW_SERVICES" },
        { type: "web_url",  title: "👤 واتساب",       url: MY_WHATSAPP_LINK }
    ]);
}

// ============================================================
// 📊 STATS & BROADCAST
// ============================================================
app.get('/stats', (req, res) => {
    const db = loadDB();
    res.json({
        totalClients: Object.keys(db.clients).length,
        totalMessages: db.stats.totalMessages,
        totalPostbacks: db.stats.totalPostbacks,
        serviceClicks: db.stats.serviceClicks,
        appointments: db.stats.appointments.length,
        lastAppointments: db.stats.appointments.slice(-5)
    });
});

app.post('/broadcast', async (req, res) => {
    const { message, secret } = req.body;
    if (secret !== process.env.BROADCAST_SECRET) return res.status(403).json({ error: 'Unauthorized' });
    const db = loadDB();
    const clients = Object.values(db.clients);
    let sent = 0;
    for (const client of clients) {
        try { await sendMsg(client.sid, message); sent++; await sleep(200); } catch (e) {}
    }
    res.json({ sent, total: clients.length });
});

// ============================================================
// 🔗 WEBHOOK
// ============================================================
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
            client.name = profile.name || null;
            client.gender = profile.gender || 'male';
        }
        client.lastSeen = new Date().toISOString();
        
        // ── رسالة نصية ──────────────────
        if (messaging.message?.text) {
            db.stats.totalMessages++;
            saveDB(db);
            const text = messaging.message.text.trim();

            if (client.awaitingBooking) {
                await handleBookingData(sid, text, client);
                continue;
            }

            await sendTyping(sid); await sleep(700);
            const aiReply = await getAIReply(text, client.gender, client.name);
            await sendMsg(sid, aiReply);
            await sleep(400);
            await sendButtons(sid, "تحب تعرف أكتر؟", [
                { type: "postback", title: "📋 الخدمات", payload: "SHOW_SERVICES" },
                { type: "postback", title: "📅 حجز موعد", payload: "BOOK_CONSULT" },
                { type: "web_url",  title: "👤 واتساب",   url: MY_WHATSAPP_LINK }
            ]);
        }

        // ── Postback ──────────────────
        if (messaging.postback) {
            db.stats.totalPostbacks++;
            saveDB(db);
            const p = messaging.postback.payload;
            await sendTyping(sid); await sleep(400);

            if      (p === 'GET_STARTED')  await sendWelcome(sid, client);
            else if (p === 'SHOW_SERVICES') await sendServicesMenu(sid);
            else if (['SRV_DESIGN','SRV_ADS','SRV_BOTS'].includes(p)) await sendServiceDetail(sid, p, client);
            else if (p === 'BOOK_CONSULT') await startBooking(sid, client);
        }
    }
    res.sendStatus(200);
});

app.listen(process.env.PORT || 3000, () =>
    console.log('✅ ELAZ Bot Live — AI + Sheets + Stats + Booking!')
);
