/**
 * 💎 ELAZ SUPREME AGENT v3.0 - "The Closer"
 * Author: Ammar Yasser (ELAZ Agency)
 * Purpose: Professional High-Ticket Sales Automation
 */

require('dotenv').config();
const express = require('express'), 
      bodyParser = require('body-parser'), 
      axios = require('axios'),
      fs = require('fs'), 
      path = require('path');

const app = express().use(bodyParser.json());

// --- CONFIGURATION ---
const { PAGE_ACCESS_TOKEN, VERIFY_TOKEN, OPENROUTER_API_KEY, ADMIN_ID } = process.env;
const DB_FILE = path.join(__dirname, 'elaz_database.json');
const WHATSAPP_LINK = "https://wa.me/201557963125";

// --- DATABASE ENGINE ---
const initDB = () => {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ clients: {}, stats: { leads: 0, conversions: 0 } }));
    }
};
initDB();

const getDB = () => JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const saveDB = (db) => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 4));

// --- ASSETS (Your Real Work) ---
const PORTFOLIO = {
    branding: {
        title: "💎 Branding: ARMADA Foods",
        img: "https://your-server.com/armada.jpg", // استبدلها بروابطك
        desc: "تصميم هوية بصرية كاملة لبراند أغذية."
    },
    ads: {
        title: "🚀 Marketing: LAPO Loan",
        img: "https://your-server.com/lapo.jpg",
        desc: "حملات إعلانية لزيادة المبيعات."
    }
};

// ==========================================
// 🧠 THE BRAIN: AI STRATEGIST
// ==========================================
async function callELAZ_AI(messages, client) {
    try {
        const systemPrompt = `
        أنت "مدير مبيعات وكالة ELAZ".
        العميل الحالي: ${client.name || 'غير معروف'}.
        مرحلة العميل: ${client.phase}.
        
        قواعد العمل الصارمة:
        1. الهدف: إقناع العميل بحجز استشارة مدفوعة أو ترك بياناته للتواصل الرسمي.
        2. الشخصية: واثق، خبير، مصري، مهذب جداً، ولا يمزح خارج نطاق العمل.
        3. إذا سأل عن السعر: "السعر استثمار بيعتمد على أهدافك، وعشان نحدد بدقة محتاجين نفهم تفاصيل مشروعك الأول".
        4. إذا حاول الهزار: "نحن في ELAZ نقدر الوقت جداً، هدفنا مساعدة الشركات على النمو. كيف يمكننا تطوير مشروعك اليوم؟"
        5. ممنوع تماماً الاعتراف بأنك "بوت". أنت "المساعد الذكي للوكالة".
        `;

        const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            model: "openai/gpt-3.5-turbo",
            messages: [{ role: "system", content: systemPrompt }, ...messages]
        }, { headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}` } });

        return response.data.choices[0].message.content;
    } catch (e) {
        return "أهلاً بك في ELAZ. نحن بصدد مراجعة طلبك، كيف يمكننا مساعدتك في نمو أعمالك؟";
    }
}

// ==========================================
// 🛠️ UTILS: MESSAGING TOOLS
// ==========================================
const sendFB = async (sid, messageData) => {
    try {
        await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            ...messageData
        });
    } catch (err) { console.error("FB API Error", err.response?.data); }
};

const sendTyping = (sid) => sendFB(sid, { sender_action: "typing_on" });

// ==========================================
// 🎯 CORE LOGIC: SALES FUNNEL
// ==========================================
async function handleSalesFunnel(sid, text) {
    const db = getDB();
    if (!db.clients[sid]) {
        db.clients[sid] = { sid, phase: 'GREETING', history: [], data: {} };
    }
    const client = db.clients[sid];
    client.history.push({ role: "user", content: text });
    if (client.history.length > 10) client.history.shift(); // الحفاظ على الذاكرة

    await sendTyping(sid);

    // 1. منطق التحقق من البيانات (Validation)
    if (client.phase === 'COLLECTING_NAME') {
        if (text.length < 3 || text.includes("ليه")) {
            const aiRedirection = await callELAZ_AI(client.history, client);
            await sendFB(sid, { message: { text: aiRedirection } });
            return;
        }
        client.data.name = text;
        client.phase = 'COLLECTING_SERVICE';
    }

    // 2. رد الذكاء الاصطناعي
    const aiResponse = await callELAZ_AI(client.history, client);
    client.history.push({ role: "assistant", content: aiResponse });
    saveDB(db);

    // 3. إرسال الرد مع العرض البصري (Portfolio)
    await sendFB(sid, { message: { text: aiResponse } });

    // إذا كان العميل مهتم بالخدمات، ابعت الكروت الفخمة
    if (client.phase === 'GREETING' || text.includes("خدمة") || text.includes("شغل")) {
        await sendPortfolioCards(sid);
    }
}

async function sendPortfolioCards(sid) {
    const elements = Object.values(PORTFOLIO).map(item => ({
        title: item.title,
        image_url: item.img,
        subtitle: item.desc,
        buttons: [{ type: "postback", title: "احجز الآن", payload: "BOOK_SERVICE" }]
    }));

    await sendFB(sid, {
        message: {
            attachment: { type: "template", payload: { template_type: "generic", elements } }
        }
    });
}

// ==========================================
// 🔌 WEBHOOK HANDLERS
// ==========================================
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            const webhook_event = entry.messaging[0];
            const sid = webhook_event.sender.id;

            if (webhook_event.message && webhook_event.message.text) {
                await handleSalesFunnel(sid, webhook_event.message.text);
            } else if (webhook_event.postback) {
                const payload = webhook_event.postback.payload;
                if (payload === 'BOOK_SERVICE') {
                    const db = getDB();
                    db.clients[sid].phase = 'COLLECTING_NAME';
                    saveDB(db);
                    await sendFB(sid, { message: { text: "على الرحب والسعة! عشان نقدملك العرض المناسب، ممكن الاسم بالكامل؟" } });
                }
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    } else { res.sendStatus(404); }
});

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else { res.sendStatus(403); }
});

// --- SERVER START ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 ELAZ SUPREME AGENT DEPLOYED ON PORT ${PORT}`);
});
