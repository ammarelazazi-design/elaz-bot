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
        fs.writeFileSync(DB_FILE, JSON.stringify({ clients: {}, stats: { appointments: [] } }));
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function getClient(db, sid) {
    if (!db.clients[sid]) {
        db.clients[sid] = { sid, name: null, phone: null, service: null, details: null, step: 0, awaitingBooking: false };
    }
    return db.clients[sid];
}

// ============================================================
// 🤖 AI RESPONSE
// ============================================================
async function askAI(message) {
    try {
        const res = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            model: "openai/gpt-3.5-turbo",
            messages: [
                { role: "system", content: "أنت مساعد ذكي لشركة ELAZ. بتتكلم مصري بأسلوب راقي ومختصر. خدماتنا: (لوجو وهوية بصرية، ميديا باينج وإعلانات ممولة، بوتات ذكية). هدفك تدردش مع العميل وتقنعه يحجز استشارة مجانية. لو سألك عن السعر قوله بيحدد بعد معرفة التفاصيل في الاستشارة." },
                { role: "user", content: message }
            ]
        }, { headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}` } });
        return res.data.choices[0].message.content;
    } catch (e) { return "نورت ELAZ! قولي حابب تعرف تفاصيل أكتر عن انهي خدمة؟"; }
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

// ============================================================
// 📲 SMART BOOKING FLOW
// ============================================================
async function handleBookingFlow(sid, text, client) {
    const db = loadDB();
    
    if (client.step === 1) {
        client.name = text;
        client.step = 2;
        saveDB(db);
        await sendTyping(sid); await sleep(500);
        await sendMsg(sid, `أهلاً بيك يا أستاذ ${text}.. ممكن تقولي تفاصيل طلبك إيه؟ (مجال شغلك وهدفك من الخدمة)`);
        return;
    }
    if (client.step === 2) {
        client.details = text;
        client.step = 3;
        saveDB(db);
        await sendTyping(sid); await sleep(500);
        await sendMsg(sid, "تمام جداً.. محتاج بس رقم تليفون حضرتك عشان الفريق يكلمك يحدد معاك الميعاد 📞");
        return;
    }
    if (client.step === 3) {
        client.phone = text;
        const appointment = { name: client.name, service: client.service, details: client.details, phone: client.phone, time: new Date().toLocaleString('ar-EG') };
        if (GOOGLE_SHEET_URL) try { await axios.post(GOOGLE_SHEET_URL, appointment); } catch (e) {}
        
        db.stats.appointments.push(appointment);
        client.awaitingBooking = false; client.step = 0; // تصفير الحالة
        saveDB(db);

        await sendMsg(sid, "تسلم يا فندم! سجلت بياناتك وان شاء الله هنتواصل معاك في أسرع وقت. ⚡");
        await sleep(800);
        await sendButtons(sid, "لو مستعجل، تقدر تكلمنا واتساب فوراً:", [{ type: "web_url", title: "👤 واتساب مباشر", url: MY_WHATSAPP_LINK }]);
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

        if (messaging.message?.text) {
            const msgText = messaging.message.text;

            // لو العميل في نص عملية الحجز، كمل معاه خطواته
            if (client.awaitingBooking && client.step > 0) {
                await handleBookingFlow(sid, msgText, client);
            } 
            // لو كلام عادي، الـ AI يرد ويحط أزرار في الآخر
            else {
                await sendTyping(sid);
                const aiReply = await askAI(msgText);
                await sendMsg(sid, aiReply);
                await sleep(500);
                await sendButtons(sid, "تحب تاخد خطوة ونبدأ شغل؟", [
                    { type: "postback", title: "📋 خدماتنا", payload: "SHOW_SERVICES" },
                    { type: "postback", title: "📅 حجز موعد", payload: "START_BOOKING" }
                ]);
            }
        }

        if (messaging.postback) {
            const p = messaging.postback.payload;
            if (p === 'START_BOOKING') {
                client.awaitingBooking = true; client.step = 1;
                saveDB(db);
                await sendMsg(sid, "تمام يا فندم، عشان نجهز للاستشارة محتاج أعرف اسم حضرتك بالكامل؟ 😊");
            } else if (p === 'SHOW_SERVICES') {
                await sendButtons(sid, "دي الخدمات اللي بنتميز بيها في ELAZ:", [
                    { type: "postback", title: "🎨 هوية بصرية", payload: "SET_SRV_DESIGN" },
                    { type: "postback", title: "📢 إعلانات ممولة", payload: "SET_SRV_ADS" },
                    { type: "postback", title: "🤖 بوتات ذكية", payload: "SET_SRV_BOTS" }
                ]);
            } else if (p.startsWith('SET_SRV_')) {
                const srvMap = { 'SET_SRV_DESIGN': 'هوية بصرية', 'SET_SRV_ADS': 'إعلانات ممولة', 'SET_SRV_BOTS': 'بوتات ذكية' };
                client.service = srvMap[p];
                client.awaitingBooking = true; client.step = 1;
                saveDB(db);
                await sendMsg(sid, `اختيار ممتاز! بخصوص الـ ${srvMap[p]}.. ممكن اسم حضرتك بالكامل؟`);
            }
        }
    }
    res.sendStatus(200);
});

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.send(req.query['hub.challenge']);
    else res.send('Error');
});

app.listen(process.env.PORT || 3000, () => console.log("🚀 ELAZ Bot Ready"));
