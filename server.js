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
const nameCache = new Map();

function getHistory(psid) { return conversations.get(psid) || []; }

function addToHistory(psid, role, content) {
    const history = getHistory(psid);
    history.push({ role, content });
    if (history.length > 6) history.splice(0, 2);
    conversations.set(psid, history);
}

// ═══════════════════════════════════════════
// تحديث الـ Prompt: "ممنوع الرغي"
// ═══════════════════════════════════════════
const SYSTEM_PROMPT = `أنت المساعد الذكي لوكالة ELAZ.
القواعد:
1. الرد مصري بيزنس، "جملة واحدة أو جملتين بالظبط". ممنوع الرغي نهائياً.
2. التخصص: تصميم، إعلانات، بوتات، مواقع.
3. الاحترام: (يا فندم، حضرتك).
4. أي سؤال بره الشغل، رد بـ: "بعتذر لحضرتك يا فندم، أنا متخصص في خدمات وكالة ELAZ فقط، أقدر أساعد حضرتك في مشروعك؟"
5. السعر: سيب رقمك وفريقنا هيكلمك.`;

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

// ═══════════════════════════════════════════
// الردود الجاهزة والمنيو
// ═══════════════════════════════════════════
async function sendWelcomeButtons(sid, name) {
    await sendTyping(sid);
    const text = `أهلاً بحضرتك يا ${name} في ELAZ! 🚀\nتحب تكمل مع المساعد الذكي ولا واتساب؟`;
    const buttons = [
        { type: "postback", title: "الذكاء الاصطناعي 🤖", payload: "START_AI" },
        { type: "web_url", title: "واتساب مباشر 👤", url: MY_WHATSAPP_LINK }
    ];
    await sendButtons(sid, text, buttons);
}

async function sendServicesMenu(sid, name) {
    await sendTyping(sid);
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            message: {
                text: `اتفضل يا ${name}، خدماتنا المتاحة:`,
                quick_replies: [
                    { content_type: "text", title: "🎨 تصميم بصري", payload: "SRV_DESIGN" },
                    { content_type: "text", title: "📢 إعلانات ممولة", payload: "SRV_ADS" },
                    { content_type: "text", title: "🤖 بوتات ذكاء", payload: "SRV_BOTS" },
                    { content_type: "text", title: "🌐 مواقع ويب", payload: "SRV_WEB" }
                ]
            }
        });
    } catch (e) {}
}

const serviceReplies = {
    SRV_DESIGN: `🎨 إحنا بنصمم هوية بصرية كاملة (لوجو، سوشيال ميديا، مطبوعات).\nسيب رقمك وفريقنا هيتواصل معاك فوراً.`,
    SRV_ADS: `📢 بنعمل حملات احترافية على فيسبوك وجوجل بأعلى نتايج.\nسيب رقمك وهنبعتلك التفاصيل.`,
    SRV_BOTS: `🤖 بنبرمج بوتات ذكية (ماسنجر وواتساب) للرد الآلي 24/7.\nسيب رقمك وهنتواصل معاك.`,
    SRV_WEB: `🌐 بنبني مواقع ويب سريعة واحترافية متوافقة مع جوجل.\nسيب رقمك وهنكلمك.`
};

// ═══════════════════════════════════════════
// الذكاء الاصطناعي (مختصر جداً)
// ═══════════════════════════════════════════
async function askGroq(userMsg, name, psid) {
    addToHistory(psid, 'user', userMsg);
    try {
        const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'llama-3.3-70b-versatile',
            max_tokens: 100, // تقليل التوكنز جداً لإجباره على الاختصار
            temperature: 0.1,
            messages: [{ role: 'system', content: `${SYSTEM_PROMPT}\nاسم العميل: ${name}` }, ...getHistory(psid)]
        }, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });
        const reply = res.data.choices[0].message.content.trim();
        addToHistory(psid, 'assistant', reply);
        return reply;
    } catch (e) { return `يا فندم ثواني وهنرد عليك بكل التفاصيل.`; }
}

const welcomeRegex = /^(أهلا|اهلا|سلام|hi|hello|hey|start|بدء|welcome)/i;
const buyRegex = /سعر|بكام|تكلفة|عرض|موبايل|رقم/i;

app.post('/webhook', async (req, res) => {
    if (req.body.object !== 'page') return res.sendStatus(404);
    res.status(200).send('EVENT_RECEIVED');

    for (const entry of req.body.entry) {
        const event = entry.messaging?.[0];
        const sid = event?.sender?.id;
        if (!sid || event.message?.is_echo) continue;

        const name = await getUserInfo(sid);

        if (event.postback) {
            const payload = event.postback.payload;
            if (payload === 'GET_STARTED') await sendWelcomeButtons(sid, name);
            else if (payload === 'START_AI') await sendServicesMenu(sid, name);
            continue;
        }

        if (event.message?.text) {
            const userMsg = event.message.text;
            const quickPayload = event.message.quick_reply?.payload;

            if (quickPayload && serviceReplies[quickPayload]) {
                await sendMsg(sid, serviceReplies[quickPayload]);
                continue;
            }

            if (welcomeRegex.test(userMsg.trim()) && userMsg.length < 10) {
                await sendWelcomeButtons(sid, name);
                continue;
            }

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
app.listen(PORT, '0.0.0.0', () => { console.log(`🚀 ELAZ LIVE!`); });
