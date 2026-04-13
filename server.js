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
// 🤖 SMART AI AGENT (The Brain)
// ============================================================
async function askAI(message, context = "") {
    try {
        const res = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            model: "openai/gpt-3.5-turbo",
            messages: [
                { 
                    role: "system", 
                    content: `أنت مساعد ذكي لشركة ELAZ للخدمات الرقمية (لوجو، ميديا باينج، بوتات).
                    تحدث بلهجة مصرية ودودة واحترافية. 
                    السياق الحالي: ${context}
                    مهمتك: الرد على استفسار العميل بلباقة وتوجيهه لإكمال عملية الحجز.` 
                },
                { role: "user", content: message }
            ]
        }, { headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}` } });
        return res.data.choices[0].message.content;
    } catch (e) { return "نورت ELAZ! ممكن تكمل معايا باقي البيانات؟"; }
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
// 📲 DYNAMIC BOOKING FLOW (AI Integrated)
// ============================================================
async function handleBookingFlow(sid, text, client) {
    const db = loadDB();
    
    // المرحلة 1: جمع الاسم
    if (client.step === 1) {
        // التحقق بالـ AI إذا كان العميل بيسأل مش بيدي اسم
        if (text.length < 3 || text.includes("ليه") || text.includes("بكام")) {
            const reply = await askAI(text, "العميل يسأل لماذا نطلب اسمه أو يستفسر عن السعر بدل ذكر اسمه.");
            await sendMsg(sid, reply);
            await sendMsg(sid, "فـ ممكن اسم حضرتك عشان نسجل الموعد؟ 😊");
            return;
        }
        client.name = text;
        client.step = 2;
        saveDB(db);
        await sendMsg(sid, `أهلاً يا أستاذ ${text}.. نورتنا! ✨`);
        await sleep(500);
        await sendMsg(sid, "ممكن تقولي تفاصيل أكتر عن طلبك؟ (مثلاً حابب تعمل لوجو لمجال إيه؟)");
        return;
    }

    // المرحلة 2: جمع التفاصيل
    if (client.step === 2) {
        client.details = text;
        client.step = 3;
        saveDB(db);
        // الـ AI هنا بيرد رد "ذكي" على تفاصيل العميل قبل ما يطلب الرقم
        const aiValidation = await askAI(text, `العميل ذكر تفاصيل طلبه وهي: ${text}. رد عليه بكلمتين تشجيع إننا نقدر نساعده واطلب منه رقم التليفون.`);
        await sendMsg(sid, aiValidation);
        await sendMsg(sid, "محتاجين بس رقم التليفون عشان الفريق يحدد معاك الميعاد 📞");
        return;
    }

    // المرحلة 3: جمع الرقم والإنهاء
    if (client.step === 3) {
        if (!/[0-9]{10,}/.test(text)) {
            await sendMsg(sid, "من فضلك ابعت رقم تليفون صحيح (مثلاً 01xxxxxxxxx)");
            return;
        }
        client.phone = text;
        const appointment = { name: client.name, service: client.service, details: client.details, phone: client.phone, time: new Date().toLocaleString('ar-EG') };
        
        if (GOOGLE_SHEET_URL) try { await axios.post(GOOGLE_SHEET_URL, appointment); } catch (e) {}
        db.stats.appointments.push(appointment);
        
        client.awaitingBooking = false; client.step = 0;
        saveDB(db);

        await sendMsg(sid, `تسلم يا أستاذ ${client.name}! بياناتك وصلت وان شاء الله فريق ELAZ هيكلمك في أسرع وقت. ⚡`);
        await sendButtons(sid, "لو حابب تكلمنا واتساب فوراً:", [{ type: "web_url", title: "👤 واتساب مباشر", url: MY_WHATSAPP_LINK }]);
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

            if (client.awaitingBooking && client.step > 0) {
                await handleBookingFlow(sid, msgText, client);
            } else {
                await sendTyping(sid);
                const aiReply = await askAI(msgText, "دردشة عامة مع عميل مهتم بخدمات ELAZ.");
                await sendMsg(sid, aiReply);
                await sleep(500);
                await sendButtons(sid, "تحب تبدأ معانا؟", [
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
                await sendMsg(sid, "تمام جداً، محتاج أعرف اسم حضرتك بالكامل عشان نسجل الحجز؟ 😊");
            } else if (p === 'SHOW_SERVICES') {
                await sendButtons(sid, "خدمات ELAZ المتاحة:", [
                    { type: "postback", title: "🎨 هوية بصرية", payload: "SET_SRV_DESIGN" },
                    { type: "postback", title: "📢 إعلانات ممولة", payload: "SET_SRV_ADS" },
                    { type: "postback", title: "🤖 بوتات ذكية", payload: "SET_SRV_BOTS" }
                ]);
            } else if (p.startsWith('SET_SRV_')) {
                const srvMap = { 'SET_SRV_DESIGN': 'هوية بصرية', 'SET_SRV_ADS': 'إعلانات ممولة', 'SET_SRV_BOTS': 'بوتات ذكية' };
                client.service = srvMap[p];
                client.awaitingBooking = true; client.step = 1;
                saveDB(db);
                await sendMsg(sid, `اختيار موفق! بخصوص ${srvMap[p]}.. ممكن اسم حضرتك؟`);
            }
        }
    }
    res.sendStatus(200);
});

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.send(req.query['hub.challenge']);
    else res.send('Error');
});

app.listen(process.env.PORT || 3000, () => console.log("🚀 ELAZ Smart Bot Live"));
