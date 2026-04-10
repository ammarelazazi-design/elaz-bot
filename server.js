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

// ═══════════════════════════════════════════
// حفظ سياق المحادثة وأسماء العملاء
// ═══════════════════════════════════════════
const conversations = new Map();
const nameCache = new Map();

function getHistory(psid) { return conversations.get(psid) || []; }

function addToHistory(psid, role, content) {
    const history = getHistory(psid);
    history.push({ role, content });
    if (history.length > 8) history.splice(0, 2); // حفظ آخر 4 تبادلات
    conversations.set(psid, history);
}

// ═══════════════════════════════════════════
// التعليمات الصارمة للبوت (System Prompt)
// ═══════════════════════════════════════════
const SYSTEM_PROMPT = `أنت المساعد الذكي الرسمي لوكالة ELAZ للتسويق الرقمي.
قواعدك الصارمة:
1. اللغة: لهجة مصرية "بيزنس" راقية جداً ومفهومة.
2. التخصص: أنت خبير فقط في (التصميم البصري، الميديا باينج، برمجة بوتات الذكاء الاصطناعي، وتطوير المواقع).
3. منع الدردشة العامة: إذا سألك العميل عن أي موضوع خارج التخصص (أفلام، طبخ، أخبار)، اعتذر برقي: "يا فندم، أنا متخصص في خدمات وكالة ELAZ الرقمية فقط، وأقدر أساعد حضرتك في تطوير مشروعك من خلال خدماتنا."
4. الاحترام: استخدم (يا فندم، حضرتك) في كل جملة.
5. صيغة الوكالة: تحدث دائماً بـ "إحنا، فريقنا، وكالتنا".
6. رد الأسعار: "بناءً على احتياجات مشروع حضرتك، بنحدد التكلفة، اتفضل سيب رقم موبايلك وفريقنا هيتواصل مع حضرتك فوراً".`;

// ═══════════════════════════════════════════
// الدوال المساعدة
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
    } catch (e) { console.error("❌ sendMsg error:", e.response?.data); }
}

async function sendButtons(sid, text, buttons) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            message: { attachment: { type: "template", payload: { template_type: "button", text, buttons } } }
        });
    } catch (e) { await sendMsg(sid, text); }
}

async function sendWelcomeButtons(sid, name) {
    await sendTyping(sid);
    const text = `أهلاً بحضرتك يا ${name} في وكالة ELAZ للتسويق الرقمي! 🚀\nتحب تكمل مع مساعدنا الذكي ولا تتواصل مع خدمة العملاء مباشرة؟`;
    const buttons = [
        { type: "postback", title: "الذكاء الاصطناعي 🤖", payload: "START_AI" },
        { type: "web_url", title: "خدمة العملاء (واتساب) 👤", url: MY_WHATSAPP_LINK }
    ];
    setTimeout(async () => { await sendButtons(sid, text, buttons); }, 1000);
}

// ═══════════════════════════════════════════
// الذكاء الاصطناعي (Groq)
// ═══════════════════════════════════════════
async function askGroq(userMsg, name, psid) {
    addToHistory(psid, 'user', userMsg);
    try {
        const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'llama-3.3-70b-versatile',
            max_tokens: 250,
            temperature: 0.1, // لضمان عدم وجود حروف غريبة أو "هلفطة"
            messages: [
                { role: 'system', content: `${SYSTEM_PROMPT}\nاسم العميل: ${name}` },
                ...getHistory(psid)
            ]
        }, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });

        let reply = res.data.choices[0].message.content;
        addToHistory(psid, 'assistant', reply);
        return reply;
    } catch (e) {
        return `يا فندم، إحنا معاك، ثواني وفريقنا في ELAZ هيرد على حضرتك بكل التفاصيل.`;
    }
}

// ═══════════════════════════════════════════
// الـ Webhooks
// ═══════════════════════════════════════════
const welcomeRegex = /^(أهلا|اهلا|سلام|hi|hello|hey|ازيك|صباح|مساء|هلو|start|بدء|welcome|؟|\?)/i;

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
            if (payload === 'GET_STARTED') {
                await sendWelcomeButtons(sid, name);
            } else if (payload === 'START_AI') {
                await sendTyping(sid);
                setTimeout(async () => {
                    await sendMsg(sid, `إحنا معاك يا ${name}، اتفضل حضرتك حابب تعرف إيه عن خدماتنا في التصميم أو الإعلانات؟`);
                }, 1000);
            }
            continue;
        }

        if (event.message?.text) {
            const userMsg = event.message.text;

            if (welcomeRegex.test(userMsg.trim())) {
                await sendWelcomeButtons(sid, name);
            } else {
                await sendTyping(sid);
                const reply = await askGroq(userMsg, name, sid);
                setTimeout(async () => { await sendMsg(sid, reply); }, 1000);
            }
        }
    }
});

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.send(req.query['hub.challenge']);
    else res.sendStatus(403);
});

app.get('/health', (req, res) => res.json({ status: 'ok', agency: 'ELAZ' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 ELAZ System is LIVE!`);
});
