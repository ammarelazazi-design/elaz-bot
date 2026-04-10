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
//  الذاكرة
// ═══════════════════════════════════════════
const conversations = new Map();
const nameCache     = new Map();
const orderState    = new Map(); // حالة الأوردر لكل عميل

function getHistory(psid) { return conversations.get(psid) || []; }
function addToHistory(psid, role, content) {
    const history = getHistory(psid);
    history.push({ role, content });
    if (history.length > 10) history.splice(0, 2);
    conversations.set(psid, history);
}

// ═══════════════════════════════════════════
//  حالات الأوردر
// ═══════════════════════════════════════════
// null = مفيش أوردر
// { step, service, name, phone, details, confirmed }

function getOrder(psid) { return orderState.get(psid) || null; }
function setOrder(psid, data) { orderState.set(psid, data); }
function clearOrder(psid) { orderState.delete(psid); }

// ═══════════════════════════════════════════
//  System Prompt
// ═══════════════════════════════════════════
const SYSTEM_PROMPT = `أنت "إيلاز"، المساعد الذكي لوكالة ELAZ.
القواعد:
1. اللغة: مصرية عامة "بيزنس" محترمة. ممنوع الفصحى.
2. الاختصار: جملة أو جملتين فقط.
3. التخصص: تصميم، إعلانات ممولة، بوتات، مواقع.
4. خارج التخصص: "يا فندم، أنا متخصص في خدمات وكالة ELAZ فقط، أقدر أساعد حضرتك في مشروعك؟"
5. السعر: "التكلفة بتتحدد على حسب مشروع حضرتك، خبيرنا هيتواصل معاك فوراً."
6. الاحترام: (يا فندم / حضرتك) دائماً.`;

const serviceNames = {
    SRV_DESIGN: '🎨 هوية بصرية',
    SRV_ADS:    '📢 إعلانات ممولة',
    SRV_BOTS:   '🤖 بوتات ذكاء اصطناعي',
    SRV_WEB:    '🌐 مواقع ويب'
};

const serviceDetails = {
    SRV_DESIGN: `🎨 بنصمم هوية بصرية كاملة (لوجو، ألوان، تصاميم سوشيال ميديا). خلينا ناخد تفاصيل مشروعك عشان نقدم لك أفضل حل.`,
    SRV_ADS:    `📢 بنعمل حملات احترافية على فيسبوك وجوجل بأعلى نتايج. خلينا ناخد تفاصيل مشروعك عشان نحدد أفضل استراتيجية.`,
    SRV_BOTS:   `🤖 بنبرمج بوتات ذكية للرد الآلي 24/7 زي اللي بتكلمه دلوقتي. خلينا ناخد تفاصيل مشروعك.`,
    SRV_WEB:    `🌐 بنبني مواقع ويب سريعة واحترافية متوافقة مع جوجل. خلينا ناخد تفاصيل مشروعك.`
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
//  رسائل البوت
// ═══════════════════════════════════════════
async function sendWelcome(sid, name) {
    await sendTyping(sid);
    await sleep(1000);
    await sendButtons(sid,
        `أهلاً بحضرتك يا ${name}! 👋 أنا "إيلاز" مساعد ELAZ الذكي.\nتحب تعرف خدماتنا ولا تتواصل واتساب مباشرة؟`,
        [
            { type: "postback", title: "خدماتنا 📋", payload: "SHOW_SERVICES" },
            { type: "web_url",  title: "واتساب 💬",  url: MY_WHATSAPP_LINK    }
        ]
    );
}

async function sendServicesMenu(sid, name) {
    await sendTyping(sid);
    await sleep(600);
    await sendQuickReplies(sid, `اختار الخدمة اللي محتاجها يا ${name} 👇`, [
        { content_type: "text", title: "🎨 هوية بصرية",    payload: "SRV_DESIGN" },
        { content_type: "text", title: "📢 إعلانات ممولة", payload: "SRV_ADS"    },
        { content_type: "text", title: "🤖 بوتات ذكاء",    payload: "SRV_BOTS"   },
        { content_type: "text", title: "🌐 مواقع ويب",     payload: "SRV_WEB"    }
    ]);
}

// ═══════════════════════════════════════════
//  فلو الأوردر — خطوة بخطوة
// ═══════════════════════════════════════════
async function startOrderFlow(sid, name, service) {
    setOrder(sid, { step: 'name', service, fbName: name, phone: null, details: null, confirmed: false });
    await sendTyping(sid);
    await sleep(800);
    await sendMsg(sid, serviceDetails[service]);
    await sleep(800);
    await sendMsg(sid, `عشان نقدم لك أفضل عرض يا ${name}، محتاج منك بيانات بسيطة.\n\nأولاً: ما اسم مشروعك أو شركتك؟`);
}

async function handleOrderFlow(sid, userMsg, name) {
    const order = getOrder(sid);
    if (!order) return false;

    // لو العميل عايز يلغي في أي وقت
    if (/إلغ|cancel|لا شكرا|مش عايز|وقفت/i.test(userMsg)) {
        clearOrder(sid);
        await sendTyping(sid);
        await sleep(500);
        await sendButtons(sid,
            `تمام يا ${name}، تم إلغاء الطلب. 👍\nلو احتجت أي حاجة تاني إحنا موجودين.`,
            [
                { type: "postback", title: "ابدأ من جديد 🔄", payload: "SHOW_SERVICES" },
                { type: "web_url",  title: "واتساب 💬",        url: MY_WHATSAPP_LINK    }
            ]
        );
        return true;
    }

    // خطوة 1: اسم المشروع
    if (order.step === 'name') {
        setOrder(sid, { ...order, step: 'phone', projectName: userMsg });
        await sendTyping(sid);
        await sleep(600);
        await sendMsg(sid, `تمام! "${userMsg}" 👌\n\nثانياً: ما رقم موبايلك عشان خبيرنا يتواصل معاك؟`);
        return true;
    }

    // خطوة 2: رقم الموبايل
    if (order.step === 'phone') {
        const phoneMatch = userMsg.match(/(\d{10,})/);
        if (!phoneMatch) {
            await sendMsg(sid, `يا فندم، محتاج رقم موبايل صحيح (10 أرقام على الأقل) عشان نتواصل معاك.`);
            return true;
        }
        setOrder(sid, { ...order, step: 'details', phone: phoneMatch[1] });
        await sendTyping(sid);
        await sleep(600);
        await sendMsg(sid, `ممتاز! 📱\n\nثالثاً: احكيلنا عن مشروعك باختصار — إيه اللي محتاجه بالظبط؟`);
        return true;
    }

    // خطوة 3: تفاصيل المشروع
    if (order.step === 'details') {
        setOrder(sid, { ...order, step: 'confirm', details: userMsg });
        const o = getOrder(sid);
        await sendTyping(sid);
        await sleep(800);

        // ملخص الطلب
        const summary = `✅ ملخص طلبك يا ${name}:\n\n` +
            `الخدمة: ${serviceNames[o.service]}\n` +
            `المشروع: ${o.projectName}\n` +
            `الموبايل: ${o.phone}\n` +
            `التفاصيل: ${o.details}\n\n` +
            `هل تأكد الطلب؟`;

        await sendButtons(sid, summary, [
            { type: "postback", title: "✅ تأكيد الطلب",   payload: "ORDER_CONFIRM" },
            { type: "postback", title: "✏️ تعديل الطلب",   payload: "ORDER_EDIT"    },
            { type: "postback", title: "❌ إلغاء الطلب",   payload: "ORDER_CANCEL"  }
        ]);
        return true;
    }

    return false;
}

// ═══════════════════════════════════════════
//  تنبيه عمار
// ═══════════════════════════════════════════
function notifyAmmar(order, fbName, psid) {
    const msg = `🎯 طلب جديد من ELAZ Bot!\n\n` +
        `👤 الاسم: ${fbName}\n` +
        `📋 الخدمة: ${serviceNames[order.service]}\n` +
        `🏢 المشروع: ${order.projectName}\n` +
        `📱 الموبايل: ${order.phone}\n` +
        `📝 التفاصيل: ${order.details}\n` +
        `🕐 الوقت: ${new Date().toLocaleString('ar-EG')}`;

    if (AMMAR_PSID) sendMsg(AMMAR_PSID, msg);
    if (ZAPIER_WEBHOOK) axios.post(ZAPIER_WEBHOOK, {
        name: fbName,
        service: serviceNames[order.service],
        project: order.projectName,
        phone: order.phone,
        details: order.details,
        psid,
        time: new Date().toLocaleString('ar-EG')
    }).catch(() => {});
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
            messages: [
                { role: 'system', content: `${SYSTEM_PROMPT}\nاسم العميل: ${name}` },
                ...getHistory(psid)
            ]
        }, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });
        const reply = res.data.choices[0].message.content.trim();
        addToHistory(psid, 'assistant', reply);
        return reply;
    } catch (e) { return `يا فندم ثواني وفريقنا هيرد على حضرتك.`; }
}

const welcomeRegex = /^(أهلا|اهلا|سلام|hi|hello|hey|start|بدء|مرحبا|هلا)$/i;

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

        // ── Postbacks ──
        if (event.postback) {
            const p = event.postback.payload;

            if (p === 'GET_STARTED')   { await sendWelcome(sid, name); continue; }
            if (p === 'SHOW_SERVICES') { await sendServicesMenu(sid, name); continue; }

            // تأكيد الأوردر
            if (p === 'ORDER_CONFIRM') {
                const order = getOrder(sid);
                if (order) {
                    notifyAmmar(order, name, sid);
                    clearOrder(sid);
                    await sendTyping(sid);
                    await sleep(800);
                    await sendMsg(sid, `🎉 تم تأكيد طلبك يا ${name}!\n\nفريق ELAZ هيتواصل معاك على رقم ${order.phone} في أقرب وقت.\nشكراً لثقتك فينا! 🙏`);
                }
                continue;
            }

            // تعديل الأوردر — يرجع للخطوة الأولى
            if (p === 'ORDER_EDIT') {
                const order = getOrder(sid);
                if (order) {
                    setOrder(sid, { ...order, step: 'name' });
                    await sendTyping(sid);
                    await sleep(500);
                    await sendMsg(sid, `تمام يا ${name}، خلينا نعدل طلبك من الأول.\n\nأولاً: ما اسم مشروعك أو شركتك؟`);
                }
                continue;
            }

            // إلغاء الأوردر
            if (p === 'ORDER_CANCEL') {
                clearOrder(sid);
                await sendTyping(sid);
                await sleep(500);
                await sendButtons(sid,
                    `تم إلغاء طلبك يا ${name}. 👍\nلو احتجت أي حاجة تاني إحنا موجودين.`,
                    [
                        { type: "postback", title: "ابدأ من جديد 🔄", payload: "SHOW_SERVICES" },
                        { type: "web_url",  title: "واتساب 💬",        url: MY_WHATSAPP_LINK    }
                    ]
                );
                continue;
            }

            // بداية أوردر خدمة
            if (serviceDetails[p]) {
                await startOrderFlow(sid, name, p);
                continue;
            }

            continue;
        }

        // ── رسائل نصية ──
        if (event.message?.text) {
            const userMsg     = event.message.text.trim();
            const qp          = event.message.quick_reply?.payload;

            // Quick Reply خدمة
            if (qp && serviceDetails[qp]) {
                await startOrderFlow(sid, name, qp);
                continue;
            }

            // لو في أوردر شغال
            if (getOrder(sid)) {
                const handled = await handleOrderFlow(sid, userMsg, name);
                if (handled) continue;
            }

            // ترحيب
            if (welcomeRegex.test(userMsg) && userMsg.length < 10) {
                await sendWelcome(sid, name);
                continue;
            }

            // رد AI عادي
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

app.get('/health', (req, res) => res.json({
    status: 'ok', agency: 'ELAZ',
    uptime: Math.floor(process.uptime()) + 's',
    users: nameCache.size,
    activeOrders: orderState.size
}));

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
    console.log(`🚀 ELAZ System Live!`);
    setupMessengerProfile();
});
