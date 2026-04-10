require('dotenv').config(); // السطر ده ضروري عشان يقرأ الملف السري
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express().use(bodyParser.json());

// المناداة على المفاتيح من ملف الـ .env
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN;
const GROQ_API_KEY      = process.env.GROQ_API_KEY; // المفتاح بقى مستخبي هنا
const AMMAR_PSID        = process.env.AMMAR_PSID;
const ZAPIER_WEBHOOK    = process.env.ZAPIER_WEBHOOK;

const MY_WHATSAPP_LINK = "https://wa.me/201557963125";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ═══════════════════════════════════════════
//  الذاكرة وحالات الأوردر
// ═══════════════════════════════════════════
const conversations = new Map();
const nameCache     = new Map();
const orderState    = new Map(); 

function getHistory(psid) { return conversations.get(psid) || []; }
function addToHistory(psid, role, content) {
    const history = getHistory(psid);
    history.push({ role, content });
    if (history.length > 10) history.splice(0, 2);
    conversations.set(psid, history);
}

function getOrder(psid) { return orderState.get(psid) || null; }
function setOrder(psid, data) { orderState.set(psid, data); }
function clearOrder(psid) { orderState.delete(psid); }

// ═══════════════════════════════════════════
//  إعدادات الشخصية والخدمات
// ═══════════════════════════════════════════
const SYSTEM_PROMPT = `أنت "إيلاز"، المساعد الذكي لوكالة ELAZ. لغتك مصرية عامة بيزنس، ردودك مختصرة جداً (جملة أو اتنين)، تخصصك: تصميم، إعلانات، بوتات، مواقع. استخدم يا فندم وحضرتك.`;

const serviceNames = {
    SRV_DESIGN: '🎨 هوية بصرية',
    SRV_ADS:    '📢 إعلانات ممولة',
    SRV_BOTS:   '🤖 بوتات ذكاء اصطناعي',
    SRV_WEB:    '🌐 مواقع ويب'
};

const serviceDetails = {
    SRV_DESIGN: `🎨 بنصمم هوية بصرية كاملة. خلينا ناخد تفاصيل مشروعك عشان نقدم لك أفضل حل.`,
    SRV_ADS:    `📢 بنعمل حملات احترافية بأعلى نتايج. خلينا ناخد تفاصيل مشروعك.`,
    SRV_BOTS:   `🤖 بنبرمج بوتات ذكية زي اللي بتكلمه دلوقتي. خلينا ناخد تفاصيل مشروعك.`,
    SRV_WEB:    `🌐 بنبني مواقع ويب سريعة واحترافية. خلينا ناخد تفاصيل مشروعك.`
};

// ═══════════════════════════════════════════
//  Facebook Helpers
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
    } catch (e) {}
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
//  فلو الأوردر (النسخة المرنة)
// ═══════════════════════════════════════════
async function startOrderFlow(sid, name, service) {
    setOrder(sid, { step: 'name', service, fbName: name, phone: null, details: null });
    await sendTyping(sid);
    await sleep(800);
    await sendMsg(sid, serviceDetails[service]);
    await sleep(800);
    await sendMsg(sid, `عشان نقدم لك أفضل عرض يا ${name}، أولاً: ما اسم مشروعك أو شركتك؟`);
}

async function handleOrderFlow(sid, userMsg, name) {
    const order = getOrder(sid);
    if (!order) return false;

    if (/إلغ|cancel|خلاص/i.test(userMsg)) {
        clearOrder(sid);
        await sendMsg(sid, `تمام يا فندم، تم إلغاء الطلب.`);
        return true;
    }

    if (order.step === 'name') {
        setOrder(sid, { ...order, step: 'phone', projectName: userMsg });
        await sendMsg(sid, `تمام! "${userMsg}" 👌\n\nثانياً: ما رقم موبايلك (أو احكيلنا تفاصيل أكتر لو حابب تدردش هنا أولاً)؟`);
        return true;
    }

    if (order.step === 'phone') {
        const phoneMatch = userMsg.match(/(\d{10,})/);
        if (phoneMatch) {
            setOrder(sid, { ...order, step: 'details', phone: phoneMatch[1] });
            await sendMsg(sid, `ممتاز! 📱\n\nثالثاً: إيه اللي محتاجه في مشروعك بالظبط؟`);
        } else {
            setOrder(sid, { ...order, step: 'details', phone: "طلب الدردشة أولاً" });
            await sendMsg(sid, `ولا يهمك يا فندم براحتك.. احكيلنا أكتر عن اللي محتاجه في مشروعك.`);
        }
        return true;
    }

    if (order.step === 'details') {
        setOrder(sid, { ...order, step: 'confirm', details: userMsg });
        const o = getOrder(sid);
        const summary = `✅ ملخص طلبك:\nالخدمة: ${serviceNames[o.service]}\nالمشروع: ${o.projectName}\nالموبايل: ${o.phone}\nالتفاصيل: ${o.details}\n\nتأكيد؟`;
        await sendButtons(sid, summary, [
            { type: "postback", title: "✅ تأكيد", payload: "ORDER_CONFIRM" },
            { type: "postback", title: "❌ إلغاء", payload: "ORDER_CANCEL" }
        ]);
        return true;
    }
    return false;
}

function notifyAmmar(order, fbName, psid) {
    const msg = `🎯 طلب جديد من ELAZ:\n👤 ${fbName}\n📋 ${serviceNames[order.service]}\n📱 ${order.phone}\n📝 ${order.details}`;
    if (AMMAR_PSID) sendMsg(AMMAR_PSID, msg);
    if (ZAPIER_WEBHOOK) axios.post(ZAPIER_WEBHOOK, { name: fbName, phone: order.phone, details: order.details }).catch(() => {});
}

// ═══════════════════════════════════════════
//  Groq AI
// ═══════════════════════════════════════════
async function askGroq(userMsg, name, psid) {
    addToHistory(psid, 'user', userMsg);
    try {
        const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'llama-3.3-70b-versatile',
            max_tokens: 100,
            temperature: 0,
            messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...getHistory(psid)]
        }, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });
        const reply = res.data.choices[0].message.content.trim();
        addToHistory(psid, 'assistant', reply);
        return reply;
    } catch (e) { return `ثواني وفريقنا هيرد على حضرتك يا فندم.`; }
}

// ═══════════════════════════════════════════
//  الويب هوك
// ═══════════════════════════════════════════
app.post('/webhook', async (req, res) => {
    if (req.body.object !== 'page') return res.sendStatus(404);
    res.status(200).send('EVENT_RECEIVED');

    for (const entry of req.body.entry) {
        const event = entry.messaging?.[0];
        const sid   = event?.sender?.id;
        if (!sid || event.message?.is_echo) continue;

        const name = await getUserInfo(sid);

        if (event.postback) {
            const p = event.postback.payload;
            if (p === 'GET_STARTED') await sendButtons(sid, `أهلاً ${name}! أنا إيلاز. تحب تعرف خدماتنا؟`, [{ type: "postback", title: "خدماتنا 📋", payload: "SHOW_SERVICES" }]);
            if (p === 'SHOW_SERVICES') await sendServicesMenu(sid, name);
            if (p === 'ORDER_CONFIRM') {
                const order = getOrder(sid);
                if (order) { notifyAmmar(order, name, sid); clearOrder(sid); await sendMsg(sid, `🎉 تم! فريق ELAZ هيكلمك فوراً.`); }
            }
            if (p === 'ORDER_CANCEL') { clearOrder(sid); await sendMsg(sid, `تم إلغاء الطلب.`); }
            if (serviceDetails[p]) await startOrderFlow(sid, name, p);
            continue;
        }

        if (event.message?.text) {
            const userMsg = event.message.text.trim();
            if (getOrder(sid)) { if (await handleOrderFlow(sid, userMsg, name)) continue; }
            if (/^(أهلا|اهلا|hi|hello)$/i.test(userMsg)) { await sendButtons(sid, `أهلاً بك! تحب تشوف خدماتنا؟`, [{ type: "postback", title: "خدماتنا 📋", payload: "SHOW_SERVICES" }]); continue; }
            
            await sendTyping(sid);
            const reply = await askGroq(userMsg, name, sid);
            await sendMsg(sid, reply);
        }
    }
});

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.send(req.query['hub.challenge']);
    else res.sendStatus(403);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => { console.log(`🚀 ELAZ Live!`); });
