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

const conversations = new Map();
const nameCache     = new Map();

function getHistory(psid) { return conversations.get(psid) || []; }

function addToHistory(psid, role, content) {
    const history = getHistory(psid);
    history.push({ role, content });
    if (history.length > 6) history.splice(0, 2);
    conversations.set(psid, history);
}

const SYSTEM_PROMPT = `أنت "إيلاز"، المساعد الذكي لوكالة ELAZ.
القواعد:
1. اللغة: مصرية عامة "بيزنس" محترمة. ممنوع الفصحى (لا تقل "نحن نستطيع" بل قل "إحنا نقدر").
2. الاختصار: الرد جملة أو جملتين فقط. لا تكتب فقرات.
3. التخصص: تصميم، إعلانات ممولة، بوتات، مواقع.
4. خارج التخصص: "يا فندم، أنا متخصص في خدمات وكالة ELAZ فقط، أقدر أساعد حضرتك في مشروعك؟"
5. السعر: اطلب الرقم وقول "خبيرنا هيتواصل معاك فوراً". ممنوع ذكر أرقام أسعار.
6. الاحترام: استخدم (يا فندم / حضرتك) دائماً.`;

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

async function sendWelcome(sid, name) {
    await sendTyping(sid);
    await sleep(1000);
    await sendButtons(sid,
        `أهلاً بحضرتك يا ${name}! 👋 أنا "إيلاز" مساعد ELAZ الذكي.\nتحب تعرف خدماتنا ولا تتواصل واتساب؟`,
        [
            { type: "postback", title: "خدماتنا 📋", payload: "SHOW_SERVICES" },
            { type: "web_url",  title: "واتساب 💬",  url: MY_WHATSAPP_LINK    }
        ]
    );
}

async function sendServicesMenu(sid, name) {
    await sendTyping(sid);
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            message: {
                text: `اختار الخدمة اللي محتاجها يا ${name} 👇`,
                quick_replies: [
                    { content_type: "text", title: "🎨 هوية بصرية",    payload: "SRV_DESIGN" },
                    { content_type: "text", title: "📢 إعلانات ممولة", payload: "SRV_ADS"    },
                    { content_type: "text", title: "🤖 بوتات ذكاء",    payload: "SRV_BOTS"   },
                    { content_type: "text", title: "🌐 مواقع ويب",     payload: "SRV_WEB"    }
                ]
            }
        });
    } catch (e) {}
}

const serviceDetails = {
    SRV_DESIGN: `🎨 بنصمم هوية بصرية كاملة (لوجو، ألوان، تصاميم سوشيال ميديا). سيب رقمك وهنكلمك.`,
    SRV_ADS:    `📢 بنعمل حملات احترافية على فيسبوك وجوجل بأعلى نتايج. سيب رقمك وهنتواصل فوراً.`,
    SRV_BOTS:   `🤖 بنبرمج بوتات ذكية للرد الآلي 24/7 زي اللي بتكلمه دلوقتي. سيب رقمك ونبدأ فوراً.`,
    SRV_WEB:    `🌐 بنبني مواقع ويب سريعة واحترافية متوافقة مع جوجل. سيب رقمك وخبيرنا هيكلمك.`
};

function notifyAmmar(name, msg, psid, source) {
    if (AMMAR_PSID) sendMsg(AMMAR_PSID, `🚨 عميل مهتم:\nالاسم: ${name}\nالمصدر: ${source}\nالرسالة: "${msg}"`);
    if (ZAPIER_WEBHOOK) axios.post(ZAPIER_WEBHOOK, {
        name, msg, psid, source, time: new Date().toLocaleString('ar-EG')
    }).catch(() => {});
}

async function askGroq(userMsg, name, psid) {
    addToHistory(psid, 'user', userMsg);
    try {
        const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'llama-3.3-70b-versatile',
            max_tokens: 80,
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
const buyRegex     = /بكام|سعر|تكلفة|عرض|رقم|موبايل|تواصل|عايز اشتغل|نبدأ ازاي/i;

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
            if (p === 'GET_STARTED')   await sendWelcome(sid, name);
            if (p === 'SHOW_SERVICES') await sendServicesMenu(sid, name);
            continue;
        }

        if (event.message?.text) {
            const userMsg = event.message.text.trim();
            const qp      = event.message.quick_reply?.payload;

            if (qp && serviceDetails[qp]) {
                await sendMsg(sid, serviceDetails[qp]);
                const serviceNames = { SRV_DESIGN: 'هوية بصرية', SRV_ADS: 'إعلانات ممولة', SRV_BOTS: 'بوتات ذكاء اصطناعي', SRV_WEB: 'مواقع ويب' };
                notifyAmmar(name, `مهتم بخدمة: ${serviceNames[qp]}`, sid, 'Service_Menu');
                continue;
            }

            if (welcomeRegex.test(userMsg) && userMsg.length < 10) {
                await sendWelcome(sid, name);
                continue;
            }

            await sendTyping(sid);
            const reply = await askGroq(userMsg, name, sid);
            await sendMsg(sid, reply);

            const hasPhone = /(\d{10,})/.test(userMsg);
            if (buyRegex.test(userMsg) || hasPhone || reply.includes('رقم') || reply.includes('هيكلمك')) {
                notifyAmmar(name, userMsg, sid, 'Priority_Lead');
            }
        }
    }
});

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.send(req.query['hub.challenge']);
    else res.sendStatus(403);
});

app.get('/health', (req, res) => res.json({
    status: 'ok',
    agency: 'ELAZ',
    uptime: Math.floor(process.uptime()) + 's',
    users: nameCache.size
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
