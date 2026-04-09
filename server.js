const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const crypto = require('crypto');

// ═══════════════════════════════════════════
//  إعداد السيرفر (تعديل مهم جداً هنا لـ rawBody)
// ═══════════════════════════════════════════
const app = express().use(bodyParser.json({
    verify: (req, res, buf) => { req.rawBody = buf; }
}));

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN;
const GROQ_API_KEY      = process.env.GROQ_API_KEY;
const ZAPIER_WEBHOOK_URL = process.env.ZAPIER_WEBHOOK_URL;
const APP_SECRET        = process.env.APP_SECRET;
const AMMAR_PSID        = process.env.AMMAR_PSID;

// ═══════════════════════════════════════════
//  حفظ سياق المحادثة
// ═══════════════════════════════════════════
const conversations = new Map();

function getHistory(psid) { return conversations.get(psid) || []; }

function addToHistory(psid, role, content) {
    const history = getHistory(psid);
    history.push({ role, content });
    if (history.length > 10) history.splice(0, 2);
    conversations.set(psid, history);
}

// ═══════════════════════════════════════════
//  1. إعداد واجهة الصفحة
// ═══════════════════════════════════════════
async function setupMessengerProfile() {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messenger_profile?access_token=${PAGE_ACCESS_TOKEN}`, {
            get_started: { payload: 'START_ELAZ' },
            greeting: [{
                locale: 'default',
                text: 'أهلاً بيك في إيلاز 🚀\nبنساعدك تكبر شغلك وتزود مبيعاتك من خلال التصميم، الإعلانات، وحلول الذكاء الاصطناعي.\n\nدوس على (بدء الاستخدام) وخلينا نبدأ.'
            }],
            persistent_menu: [{
                locale: 'default',
                composer_input_disabled: false,
                call_to_actions: [
                    { type: 'postback', title: '🎨 تصميم احترافي', payload: 'SERVICE_DESIGN' },
                    { type: 'postback', title: '📢 إعلانات ممولة', payload: 'SERVICE_ADS' },
                    { type: 'postback', title: '🤖 بوتات وذكاء اصطناعي', payload: 'SERVICE_BOTS' },
                    { type: 'postback', title: '💰 الأسعار والعروض', payload: 'PRICING' },
                    { type: 'postback', title: '📞 تواصل مع فريقنا', payload: 'CONTACT' }
                ]
            }]
        });
        console.log('✅ تم ضبط واجهة الصفحة بنجاح');
    } catch (e) { console.error('❌ فشل ضبط الواجهة'); }
}

// ═══════════════════════════════════════════
//  2. جلب اسم العميل
// ═══════════════════════════════════════════
const nameCache = new Map();
async function getUserInfo(psid) {
    if (nameCache.has(psid)) return nameCache.get(psid);
    try {
        const res = await axios.get(`https://graph.facebook.com/${psid}?fields=first_name&access_token=${PAGE_ACCESS_TOKEN}`);
        const name = res.data.first_name || 'يا فنان';
        nameCache.set(psid, name);
        return name;
    } catch (e) { return 'يا فنان'; }
}

// ═══════════════════════════════════════════
//  3. التحقق من الأمان (التصحيح النهائي)
// ═══════════════════════════════════════════
function verifySignature(req) {
    const signature = req.headers['x-hub-signature-256'];
    if (!signature || !APP_SECRET) return !!signature === !!APP_SECRET;

    const signatureHash = signature.split('=')[1];
    const expectedHash = crypto.createHmac('sha256', APP_SECRET)
                               .update(req.rawBody)
                               .digest('hex');

    return signatureHash === expectedHash;
}

// ═══════════════════════════════════════════
//  4. الأدوات المساعدة
// ═══════════════════════════════════════════
async function sendTyping(sid) {
    try { await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: sid }, sender_action: 'typing_on' }); } catch (e) {}
}

async function sendMsg(sid, text) {
    try { await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: sid }, message: { text } }); } catch (e) {}
}

async function sendQuickReplies(sid, text, replies) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            message: { text, quick_replies: replies.map(r => ({ content_type: 'text', title: r.title, payload: r.payload })) }
        });
    } catch (e) { await sendMsg(sid, text); }
}

// ═══════════════════════════════════════════
//  5. الذكاء الاصطناعي
// ═══════════════════════════════════════════
async function askGroq(userMsg, firstName, psid) {
    addToHistory(psid, 'user', userMsg);
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'system', content: `أنت مساعد وكالة ELAZ. رد بلهجة مصرية محترمة وقصيرة جداً. العميل اسمه ${firstName}. لو سأل عن سعر قوله أستاذ عمار هيحدد معاك.` }, ...getHistory(psid)],
            max_tokens: 300
        }, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });
        const aiReply = response.data.choices[0].message.content;
        addToHistory(psid, 'assistant', aiReply);
        return aiReply;
    } catch (e) { return `وصلت رسالتك يا ${firstName}، أستاذ عمار هيتواصل معاك حالاً.`; }
}

// ═══════════════════════════════════════════
//  6. معالجة الأزرار والتنبيهات
// ═══════════════════════════════════════════
const postbackResponses = {
    START_ELAZ: async (sid, firstName) => {
        await sendQuickReplies(sid, `أهلاً بيك يا ${firstName} في إيلاز! 🚀\nبنساعدك تكبر شغلك من خلال التصميم والإعلانات وبوتات الذكاء الاصطناعي.\n\nمحتاج مساعدة في إيه؟`, [
            { title: '🎨 تصميم', payload: 'SERVICE_DESIGN' }, { title: '📢 إعلانات', payload: 'SERVICE_ADS' }, { title: '🤖 بوتات', payload: 'SERVICE_BOTS' }, { title: '💰 الأسعار', payload: 'PRICING' }
        ]);
    },
    SERVICE_DESIGN: async (sid, name) => await sendMsg(sid, `تصميماتنا يا ${name} بتشمل الهوية البصرية كاملة وتصاميم السوشيال ميديا باحترافية.`),
    SERVICE_ADS: async (sid, name) => await sendMsg(sid, `بنعمل إعلانات ممولة بتستهدف عميلك الصح على كل المنصات.`),
    SERVICE_BOTS: async (sid, name) => await sendMsg(sid, `بنعملك بوت ذكي يرد على عملائك 24 ساعة ويوفر وقتك.`),
    PRICING: async (sid, name) => {
        await sendMsg(sid, `الأسعار بتعتمد على طلبك يا ${name}. أستاذ عمار هيكلمك يحدد معاك أنسب عرض.`);
        notifyAmmar(name, 'بيسأل عن الأسعار', sid);
    },
    CONTACT: async (sid, name) => {
        await sendMsg(sid, `تمام يا ${name}، أستاذ عمار هيتواصل معاك فوراً.`);
        notifyAmmar(name, 'طلب تواصل مباشر', sid);
    }
};

function notifyAmmar(name, msg, psid) {
    if (AMMAR_PSID) sendMsg(AMMAR_PSID, `🚨 عميل جديد:\nالاسم: ${name}\nالرسالة: ${msg}`);
    if (ZAPIER_WEBHOOK_URL) axios.post(ZAPIER_WEBHOOK_URL, { name, msg, psid, time: new Date().toLocaleString('ar-EG') }).catch(() => {});
}

// ═══════════════════════════════════════════
//  7. الـ Webhooks
// ═══════════════════════════════════════════
app.post('/webhook', async (req, res) => {
    if (!verifySignature(req)) return res.sendStatus(403);
    res.status(200).send('EVENT_RECEIVED');

    const entry = req.body.entry?.[0];
    const event = entry?.messaging?.[0];
    const sid = event?.sender?.id;

    if (!sid || sid === AMMAR_PSID) return;
    const name = await getUserInfo(sid);

    if (event.postback) {
        const handler = postbackResponses[event.postback.payload];
        if (handler) await handler(sid, name);
    } else if (event.message?.text && !event.message.is_echo) {
        const text = event.message.text;
        if (/سعر|بكام|تكلفة|عرض/i.test(text)) notifyAmmar(name, text, sid);
        await sendTyping(sid);
        const reply = await askGroq(text, name, sid);
        await sendMsg(sid, reply);
    }
});

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.send(req.query['hub.challenge']);
    else res.sendStatus(403);
});

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

app.listen(process.env.PORT || 3000, () => {
    console.log('🚀 ELAZ Bot is LIVE!');
    setupMessengerProfile();
});
