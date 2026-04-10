const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express().use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN;
const GROQ_API_KEY      = process.env.GROQ_API_KEY;
const AMMAR_PSID        = process.env.AMMAR_PSID;
const ZAPIER_WEBHOOK    = process.env.ZAPIER_WEBHOOK;

const MY_WHATSAPP_LINK = "https://wa.me/201557963125";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ═══════════════════════════════════════════
//  Memory
// ═══════════════════════════════════════════
const conversations = new Map();
const nameCache     = new Map();
const userState     = new Map(); // تتبع حالة العميل

function getHistory(psid) { return conversations.get(psid) || []; }

function addToHistory(psid, role, content) {
    const history = getHistory(psid);
    history.push({ role, content });
    if (history.length > 10) history.splice(0, 2);
    conversations.set(psid, history);
}

// ═══════════════════════════════════════════
//  System Prompt — الشخصية المميزة
// ═══════════════════════════════════════════
const SYSTEM_PROMPT = `أنت "إيلاز"، المساعد الذكي الرسمي لوكالة ELAZ للتسويق الرقمي والذكاء الاصطناعي.
شخصيتك: خبير تسويق رقمي مصري محترف، واثق، ذكي، وعملي. مش بوت عادي — أنت صوت وكالة متميزة.

✦ قواعد الأسلوب:
- لهجة مصرية راقية ومحترمة، صيغة الجمع دايمًا (إحنا، فريقنا، وكالتنا).
- استخدم (يا فندم / حضرتك) في كل رد.
- الرد: جملتين أو ثلاثة بالظبط. مختصر، واضح، ومؤثر.
- لا تكرر نفسك. كل رد يضيف قيمة جديدة.

✦ تخصصك الحصري:
1. تصميم الهوية البصرية (لوجو، براند، سوشيال ميديا)
2. الإعلانات الممولة (فيسبوك، إنستجرام، جوجل)
3. بوتات الذكاء الاصطناعي (ماسنجر، واتساب، أتمتة)
4. تطوير المواقع (سريعة، SEO، لوحة تحكم)

✦ قواعد صارمة:
- لو سألك عن أي حاجة بره التخصص: "بعتذر يا فندم، أنا متخصص في خدمات ELAZ الرقمية فقط. حضرتك عايز تطور مشروعك إزاي؟"
- لو سأل عن سعر: "التكلفة بتتحدد على حسب تفاصيل مشروع حضرتك. سيب رقمك وخبير ELAZ هيعمل معاك عرض مخصص فوراً." — ثم نبّه عمار.
- لو شكى أو اتضايق: "يا فندم أنا آسف على أي إزعاج، فريقنا موجود عشان يريح حضرتك. سيب رقمك وهنتواصل فوراً."
- لا تذكر أي رقم سعر أبداً.`;

// ═══════════════════════════════════════════
//  Facebook API Helpers
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
    } catch (e) { console.error("❌ sendMsg:", e.response?.data); }
}

async function sendButtons(sid, text, buttons) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            message: { attachment: { type: "template", payload: { template_type: "button", text, buttons } } }
        });
    } catch (e) { await sendMsg(sid, text); }
}

async function sendQuickReplies(sid, text, replies) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            message: { text, quick_replies: replies }
        });
    } catch (e) { await sendMsg(sid, text); }
}

// ═══════════════════════════════════════════
//  رسالة الترحيب — أول انطباع مميز
// ═══════════════════════════════════════════
async function sendWelcome(sid, name) {
    await sendTyping(sid);
    await sleep(1200);

    await sendButtons(sid,
        `أهلاً بحضرتك يا ${name}! 👋\n\nأنا "إيلاز"، مساعد وكالة ELAZ الذكي.\nإحنا بنبني براندات مميزة وحملات تسويقية بنتايج حقيقية.\n\nكيف أقدر أخدم حضرتك النهارده؟`,
        [
            { type: "postback", title: "اعرف خدماتنا 📋", payload: "SHOW_SERVICES" },
            { type: "web_url",  title: "تواصل واتساب 💬", url: MY_WHATSAPP_LINK }
        ]
    );
}

// ═══════════════════════════════════════════
//  قائمة الخدمات — تصميم احترافي
// ═══════════════════════════════════════════
async function sendServicesMenu(sid, name) {
    await sendTyping(sid);
    await sleep(800);

    // رسالة تشويقية أولاً
    await sendMsg(sid, `✦ خدمات وكالة ELAZ الرقمية\n\nاختار المجال اللي يهمك يا ${name} وهنديك كل التفاصيل:`);
    await sleep(600);

    await sendQuickReplies(sid, 'اختار الخدمة 👇', [
        { content_type: "text", title: "🎨 هوية بصرية",    payload: "SRV_DESIGN" },
        { content_type: "text", title: "📢 إعلانات ممولة", payload: "SRV_ADS"    },
        { content_type: "text", title: "🤖 بوتات ذكاء",    payload: "SRV_BOTS"   },
        { content_type: "text", title: "🌐 مواقع ويب",     payload: "SRV_WEB"    }
    ]);
}

// ═══════════════════════════════════════════
//  ردود الخدمات — مكتوبة بأسلوب مقنع
// ═══════════════════════════════════════════
const serviceDetails = {
    SRV_DESIGN: {
        msg: `🎨 الهوية البصرية — أول ما العميل يشوف براندك، قرار الشراء بيبدأ.\n\nإحنا بنصمم:\n✦ لوجو احترافي يعبر عن روح مشروعك\n✦ هوية بصرية متكاملة (ألوان، خطوط، أسلوب)\n✦ تصاميم سوشيال ميديا جاهزة للنشر\n✦ مطبوعات وبروفايل شركة\n\nحضرتك عندك مشروع محتاج هوية؟ سيب رقمك وهنكلمك.`,
        notify: true
    },
    SRV_ADS: {
        msg: `📢 الإعلانات الممولة — كل جنيه في مكانه الصح.\n\nفريقنا بيدير حملات على:\n✦ فيسبوك وإنستجرام (Meta Ads)\n✦ جوجل ويوتيوب (Google Ads)\n✦ استهداف دقيق للجمهور المناسب\n✦ تقارير أسبوعية شفافة بكل النتائج\n\nعايز تزود مبيعاتك؟ سيب رقمك وهنعمل لك استراتيجية مجانية.`,
        notify: true
    },
    SRV_BOTS: {
        msg: `🤖 بوتات الذكاء الاصطناعي — زي اللي بتكلمه دلوقتي!\n\nإحنا بنبني:\n✦ بوتات ماسنجر وواتساب ذكية\n✦ ردود آلية 24/7 بدون انتظار\n✦ ربط مع أنظمة البيع والمتابعة\n✦ لوحة تحكم كاملة لمتابعة العملاء\n\nعايز بوت زي ده لشركتك؟ سيب رقمك وهنبدأ.`,
        notify: true
    },
    SRV_WEB: {
        msg: `🌐 تطوير المواقع — واجهتك الرقمية على النت.\n\nبنبني مواقع:\n✦ سريعة جداً ومتوافقة مع الموبايل\n✦ محسّنة لمحركات البحث (SEO)\n✦ لوحة تحكم سهلة تدير موقعك بنفسك\n✦ دومين وهوستنج واستضافة\n\nمحتاج موقع احترافي؟ سيب رقمك وهنتواصل.`,
        notify: true
    }
};

// ═══════════════════════════════════════════
//  تنبيه عمار + Zapier
// ═══════════════════════════════════════════
function notifyAmmar(name, msg, psid, source = 'chat') {
    const alert = `🚨 عميل محتاج تواصل:\nالاسم: ${name}\nالمصدر: ${source}\nالرسالة: "${msg}"`;
    if (AMMAR_PSID) sendMsg(AMMAR_PSID, alert);
    if (ZAPIER_WEBHOOK) axios.post(ZAPIER_WEBHOOK, {
        name, msg, psid, source,
        time: new Date().toLocaleString('ar-EG')
    }).catch(() => {});
}

// ═══════════════════════════════════════════
//  Groq AI — الذكاء الاصطناعي
// ═══════════════════════════════════════════
async function askGroq(userMsg, name, psid) {
    addToHistory(psid, 'user', userMsg);
    try {
        const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'llama-3.3-70b-versatile',
            max_tokens: 200,
            temperature: 0.2,
            messages: [
                { role: 'system', content: `${SYSTEM_PROMPT}\nاسم العميل الحالي: ${name}` },
                ...getHistory(psid)
            ]
        }, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });

        const reply = res.data.choices[0].message.content.trim();
        addToHistory(psid, 'assistant', reply);
        return reply;
    } catch (e) {
        console.error("❌ Groq:", e.response?.data || e.message);
        return `يا فندم، إحنا آسفين على التأخير. فريق ELAZ هيرد على حضرتك فوراً.`;
    }
}

// ═══════════════════════════════════════════
//  Regex للكشف
// ═══════════════════════════════════════════
const welcomeRegex = /^(أهلا|اهلا|سلام|مرحبا|hi|hello|hey|start|بدء|هلا|هاي|السلام)[\s\S]{0,20}$/i;
const buyRegex     = /سعر|بكام|تكلفة|عرض|رقم|موبايل|تواصل|ازاي نبدأ|عايز اشتغل|نبدأ إزاي/i;

// ═══════════════════════════════════════════
//  Webhook الرئيسي
// ═══════════════════════════════════════════
app.post('/webhook', async (req, res) => {
    if (req.body.object !== 'page') return res.sendStatus(404);
    res.status(200).send('EVENT_RECEIVED');

    for (const entry of req.body.entry) {
        const event = entry.messaging?.[0];
        const sid   = event?.sender?.id;
        if (!sid || event.message?.is_echo) continue;

        const name = await getUserInfo(sid);

        // ── Postback (أزرار) ──
        if (event.postback) {
            const payload = event.postback.payload;
            if (payload === 'GET_STARTED')    { await sendWelcome(sid, name); continue; }
            if (payload === 'SHOW_SERVICES')  { await sendServicesMenu(sid, name); continue; }
            continue;
        }

        // ── رسائل نصية ──
        if (event.message?.text) {
            const userMsg      = event.message.text.trim();
            const quickPayload = event.message.quick_reply?.payload;

            // Quick Reply — خدمة محددة
            if (quickPayload && serviceDetails[quickPayload]) {
                const svc = serviceDetails[quickPayload];
                await sendTyping(sid);
                await sleep(800);
                await sendMsg(sid, svc.msg);
                if (svc.notify) notifyAmmar(name, quickPayload, sid, 'services_menu');
                continue;
            }

            // ترحيب
            if (welcomeRegex.test(userMsg)) {
                await sendWelcome(sid, name);
                continue;
            }

            // كشف نية الشراء
            if (buyRegex.test(userMsg)) notifyAmmar(name, userMsg, sid, 'buy_intent');

            // رد الـ AI
            await sendTyping(sid);
            await sleep(1000);
            const reply = await askGroq(userMsg, name, sid);
            await sendMsg(sid, reply);

            // لو الـ AI ذكر "سيب رقمك" — نبّه عمار
            if (reply.includes('رقم') || reply.includes('هنكلمك')) {
                notifyAmmar(name, userMsg, sid, 'ai_handoff');
            }
        }
    }
});

// ── Webhook Verification ──
app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.send(req.query['hub.challenge']);
    else res.sendStatus(403);
});

// ── Health Check ──
app.get('/health', (req, res) => res.json({
    status: 'ok',
    agency: 'ELAZ',
    uptime: Math.floor(process.uptime()) + 's',
    users: nameCache.size
}));

// ── إعداد واجهة الصفحة ──
async function setupMessengerProfile() {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messenger_profile?access_token=${PAGE_ACCESS_TOKEN}`, {
            get_started: { payload: 'GET_STARTED' },
            greeting: [{
                locale: 'default',
                text: '👋 أهلاً بحضرتك في وكالة ELAZ للتسويق الرقمي!\nإحنا بنبني براندات مميزة وحملات تحقق نتايج حقيقية.\n\nاضغط "بدء الاستخدام" وخلينا نبدأ 🚀'
            }],
            persistent_menu: [{
                locale: 'default',
                composer_input_disabled: false,
                call_to_actions: [
                    { type: 'postback', title: '📋 خدماتنا',      payload: 'SHOW_SERVICES' },
                    { type: 'web_url',  title: '💬 واتساب مباشر', url: MY_WHATSAPP_LINK    }
                ]
            }]
        });
        console.log('✅ Messenger Profile configured');
    } catch (e) { console.error('❌ Profile setup failed:', e.message); }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 ELAZ AI System — LIVE on port ${PORT}`);
    setupMessengerProfile();
});
