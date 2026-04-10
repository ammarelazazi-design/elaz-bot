const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express().use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN;
const GROQ_API_KEY      = process.env.GROQ_API_KEY;
const AMMAR_PSID        = process.env.AMMAR_PSID;
const ZAPIER_WEBHOOK    = process.env.ZAPIER_WEBHOOK;

const MY_WHATSAPP_LINK = "https://wa.me/201201550186";

// ═══════════════════════════════════════════
//  حفظ سياق المحادثة (كان ناقص خالص)
// ═══════════════════════════════════════════
const conversations = new Map();
const nameCache = new Map();

function getHistory(psid) { return conversations.get(psid) || []; }

function addToHistory(psid, role, content) {
    const history = getHistory(psid);
    history.push({ role, content });
    if (history.length > 10) history.splice(0, 2);
    conversations.set(psid, history);
}

// ═══════════════════════════════════════════
//  System Prompt
// ═══════════════════════════════════════════
const SYSTEM_PROMPT = `أنت المساعد الذكي الرسمي لوكالة ELAZ للتسويق الرقمي والذكاء الاصطناعي.
قواعدك الصارمة للتعامل:
1. اللغة: رد باللهجة المصرية "بيزنس" راقية جداً وبصيغة الجمع (إحنا، فريقنا). تتحدث بجميع اللغات وحتى الفرانكو.
2. الاحترام: يجب استخدام كلمات (حضرتك، يا فندم، اتفضل حضرتك) دائماً.
3. ضبط النفس: مهما كان أسلوب العميل، يجب أن تظل محترماً جداً ومهذباً وبأعلى درجات الرقي.
4. التخصص: تصميم الهوية البصرية، الميديا باينج، برمجة بوتات الذكاء الاصطناعي، تطوير المواقع.
5. رد الأسعار: "بناءً على احتياجات مشروع حضرتك، بنحدد التكلفة، اتفضل سيب رقم موبايلك وفريقنا هيتواصل مع حضرتك فوراً".
6. الرد دايماً مختصر (3-4 جمل بحد أقصى).`;

// ═══════════════════════════════════════════
//  جلب اسم العميل
// ═══════════════════════════════════════════
async function getUserInfo(psid) {
    if (nameCache.has(psid)) return nameCache.get(psid);
    try {
        const res = await axios.get(`https://graph.facebook.com/${psid}?fields=first_name&access_token=${PAGE_ACCESS_TOKEN}`);
        const name = res.data.first_name || 'يا فندم';
        nameCache.set(psid, name);
        return name;
    } catch (e) { return 'يا فندم'; }
}

// ═══════════════════════════════════════════
//  إرسال الرسائل
// ═══════════════════════════════════════════
async function sendTyping(sid) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            { recipient: { id: sid }, sender_action: "typing_on" });
    } catch (e) {}
}

async function sendMsg(sid, text) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            { recipient: { id: sid }, message: { text } });
    } catch (e) { console.error("❌ sendMsg error:", e.response?.data); }
}

async function sendButtons(sid, text, buttons) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            message: {
                attachment: {
                    type: "template",
                    payload: { template_type: "button", text, buttons }
                }
            }
        });
    } catch (e) {
        console.error("❌ Button error:", e.response?.data);
        await sendMsg(sid, text);
    }
}

// ═══════════════════════════════════════════
//  رسالة الترحيب بالأزرار
// ═══════════════════════════════════════════
async function sendWelcomeButtons(sid, name) {
    await sendTyping(sid);
    await new Promise(r => setTimeout(r, 1000));
    await sendButtons(sid,
        `أهلاً بحضرتك يا ${name} في وكالة ELAZ للتسويق الرقمي! 🚀\nتحب تكمل مع مساعدنا الذكي ولا تتواصل مع خدمة العملاء مباشرة؟`,
        [
            { type: "postback", title: "الذكاء الاصطناعي 🤖", payload: "START_AI" },
            { type: "web_url", title: "خدمة العملاء (واتساب) 👤", url: MY_WHATSAPP_LINK }
        ]
    );
}

// ═══════════════════════════════════════════
//  تنبيه عمار
// ═══════════════════════════════════════════
function notifyAmmar(name, msg, psid) {
    //if (AMMAR_PSID) sendMsg(AMMAR_PSID, `🚨 عميل محتاج تواصل:\nالاسم: ${name}\nالرسالة: "${msg}"`);
    if (ZAPIER_WEBHOOK) axios.post(ZAPIER_WEBHOOK, {
        name, msg, psid, time: new Date().toLocaleString('ar-EG')
    }).catch(() => {});
}

// ═══════════════════════════════════════════
//  الذكاء الاصطناعي مع سياق المحادثة
// ═══════════════════════════════════════════
async function askGroq(userMsg, name, psid) {
    addToHistory(psid, 'user', userMsg);
    try {
        const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'llama-3.3-70b-versatile',
            max_tokens: 300,
            messages: [
                { role: 'system', content: `${SYSTEM_PROMPT}\nاسم العميل: ${name}` },
                ...getHistory(psid)
            ]
        }, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });

        const reply = res.data.choices[0].message.content;
        addToHistory(psid, 'assistant', reply);
        return reply;
    } catch (e) {
        console.error("❌ Groq error:", e.response?.data || e.message);
        return `ثواني يا ${name} وفريقنا هيرد على حضرتك بكل التفاصيل 🙏`;
    }
}

// ═══════════════════════════════════════════
//  Webhook الرئيسي
// ═══════════════════════════════════════════
const welcomeRegex = /^(أهلا|اهلا|سلام|hi|hello|hey|ازيك|صباح|مساء|هلو|start|بدء|welcome)/i;
const buyRegex = /سعر|بكام|تكلفة|عرض|ازاي نبدأ|باكدج|موبايل|رقم/i;

app.post('/webhook', async (req, res) => {
    if (req.body.object !== 'page') return res.sendStatus(404);
    res.status(200).send('EVENT_RECEIVED');

    for (const entry of req.body.entry) {
        const event = entry.messaging?.[0];
        const sid = event?.sender?.id;

        // تجاهل الـ echo ورسائل عمار
        if (!sid || event.message?.is_echo || sid === AMMAR_PSID) continue;

        const name = await getUserInfo(sid);

        // ─── Postback (أزرار) ───
        if (event.postback) {
            const payload = event.postback.payload;
            if (payload === 'GET_STARTED' || payload === 'START_ELAZ') {
                await sendWelcomeButtons(sid, name);
            } else if (payload === 'START_AI') {
                await sendTyping(sid);
                await new Promise(r => setTimeout(r, 1000));
                await sendMsg(sid, `إحنا معاك يا ${name}، اتفضل حضرتك حابب تعرف إيه عن خدماتنا؟`);
            }
            continue;
        }

        // ─── رسالة نصية ───
        if (event.message?.text) {
            const userMsg = event.message.text;

            // كشف نية الشراء وتنبيه عمار
            if (buyRegex.test(userMsg)) notifyAmmar(name, userMsg, sid);

            // رسالة ترحيب
            if (welcomeRegex.test(userMsg.trim())) {
                await sendWelcomeButtons(sid, name);
                continue;
            }

            // رد الـ AI مع السياق
            await sendTyping(sid);
            const reply = await askGroq(userMsg, name, sid);
            await sendMsg(sid, reply);

            // إرسال لـ Zapier
            if (ZAPIER_WEBHOOK) {
                axios.post(ZAPIER_WEBHOOK, {
                    name, msg: userMsg, reply, psid: sid,
                    time: new Date().toLocaleString('ar-EG')
                }).catch(() => {});
            }
        }
    }
});

// ─── Webhook Verification ───
app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.send(req.query['hub.challenge']);
    else res.sendStatus(403);
});

// ─── Health Check ───
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ─── إعداد واجهة الصفحة ───
async function setupMessengerProfile() {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messenger_profile?access_token=${PAGE_ACCESS_TOKEN}`, {
            get_started: { payload: 'GET_STARTED' },
            greeting: [{ locale: 'default', text: 'أهلاً بحضرتك في وكالة ELAZ 🚀\nدوس على (بدء الاستخدام) وخلينا نبدأ.' }]
        });
        console.log('✅ تم ضبط واجهة الصفحة بنجاح');
    } catch (e) { console.error('❌ فشل ضبط الواجهة:', e.message); }
}

app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
    console.log('🚀 ELAZ Bot is LIVE!');
    setupMessengerProfile();
});
