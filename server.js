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
// حفظ سياق المحادثة وأسماء العملاء
// ═══════════════════════════════════════════
const conversations = new Map();
const nameCache = new Map();

function getHistory(psid) { return conversations.get(psid) || []; }

function addToHistory(psid, role, content) {
    const history = getHistory(psid);
    history.push({ role, content });
    if (history.length > 8) history.splice(0, 2);
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

// ═══════════════════════════════════════════
// رسالة الترحيب بالأزرار
// ═══════════════════════════════════════════
async function sendWelcomeButtons(sid, name) {
    await sendTyping(sid);
    await sleep(1000);
    await sendButtons(sid,
        `أهلاً بحضرتك يا ${name} في وكالة ELAZ للتسويق الرقمي! 🚀\nتحب تكمل مع مساعدنا الذكي ولا تتواصل مع خدمة العملاء مباشرة؟`,
        [
            { type: "postback", title: "الذكاء الاصطناعي 🤖", payload: "START_AI" },
            { type: "web_url", title: "خدمة العملاء (واتساب) 👤", url: MY_WHATSAPP_LINK }
        ]
    );
}

// ═══════════════════════════════════════════
// قائمة الخدمات (Quick Replies)
// ═══════════════════════════════════════════
async function sendServicesMenu(sid, name) {
    await sendTyping(sid);
    await sleep(800);
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sid },
            message: {
                text: `اتفضل يا ${name}، اختار الخدمة اللي تهمك 👇`,
                quick_replies: [
                    { content_type: "text", title: "🎨 تصميم بصري", payload: "SRV_DESIGN" },
                    { content_type: "text", title: "📢 إعلانات ممولة", payload: "SRV_ADS" },
                    { content_type: "text", title: "🤖 بوتات ذكاء", payload: "SRV_BOTS" },
                    { content_type: "text", title: "🌐 مواقع ويب", payload: "SRV_WEB" },
                    { content_type: "text", title: "💰 الأسعار", payload: "SRV_PRICE" }
                ]
            }
        });
    } catch (e) { await sendMsg(sid, `خدماتنا: تصميم بصري، إعلانات ممولة، بوتات ذكاء اصطناعي، مواقع ويب. أيهم يهم حضرتك؟`); }
}

// ═══════════════════════════════════════════
// ردود الخدمات الجاهزة
// ═══════════════════════════════════════════
const serviceReplies = {
    SRV_DESIGN: `🎨 خدمة التصميم البصري:\nإحنا بنصمم هوية بصرية كاملة للبراند حضرتك تشمل:\n- لوجو احترافي\n- بروفايل شركة\n- تصاميم سوشيال ميديا\n- مطبوعات بكل أنواعها\n\nاتفضل سيب رقمك وفريقنا يتواصل مع حضرتك فوراً 📞`,
    SRV_ADS: `📢 خدمة الإعلانات الممولة:\nإحنا بنوصل رسالتك للعميل الصح بأقل تكلفة:\n- فيسبوك وإنستجرام\n- جوجل ويوتيوب\n- إدارة كاملة للحملات\n- تقارير دورية بالنتائج\n\nاتفضل سيب رقمك وفريقنا يتواصل مع حضرتك فوراً 📞`,
    SRV_BOTS: `🤖 خدمة بوتات الذكاء الاصطناعي:\nزي البوت اللي بتكلمه دلوقتي!\nبنعمل بوتات:\n- ماسنجر وواتساب\n- ردود ذكية 24/7\n- ربط مع أنظمة البيع\n- لوحة تحكم كاملة\n\nاتفضل سيب رقمك وفريقنا يتواصل مع حضرتك فوراً 📞`,
    SRV_WEB: `🌐 خدمة تطوير المواقع:\nبنعمل مواقع احترافية:\n- سريعة ومتوافقة مع الموبايل\n- متوافقة مع SEO\n- لوحة تحكم سهلة\n- دومين وهوستنج\n\nاتفضل سيب رقمك وفريقنا يتواصل مع حضرتك فوراً 📞`,
    SRV_PRICE: `💰 الأسعار:\nبناءً على احتياجات مشروع حضرتك، بنحدد التكلفة المناسبة.\n\nاتفضل سيب رقم موبايلك وفريقنا هيتواصل مع حضرتك فوراً ويعمل عرض سعر مخصص 📞`
};

// ═══════════════════════════════════════════
// تنبيه عمار + Zapier
// ═══════════════════════════════════════════
function notifyAmmar(name, msg, psid) {
    if (AMMAR_PSID) sendMsg(AMMAR_PSID, `🚨 عميل محتاج تواصل:\nالاسم: ${name}\nالرسالة: "${msg}"`);
    if (ZAPIER_WEBHOOK) axios.post(ZAPIER_WEBHOOK, {
        name, msg, psid, time: new Date().toLocaleString('ar-EG')
    }).catch(() => {});
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
            temperature: 0.1,
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
        return `يا فندم، إحنا معاك، ثواني وفريقنا في ELAZ هيرد على حضرتك بكل التفاصيل.`;
    }
}

// ═══════════════════════════════════════════
// Webhook الرئيسي
// ═══════════════════════════════════════════
const welcomeRegex = /^(أهلا|اهلا|سلام|hi|hello|hey|ازيك|صباح|مساء|هلو|start|بدء|welcome|مرحبا)/i;
const buyRegex = /سعر|بكام|تكلفة|عرض|ازاي نبدأ|باكدج|موبايل|رقم|تواصل/i;

app.post('/webhook', async (req, res) => {
    if (req.body.object !== 'page') return res.sendStatus(404);
    res.status(200).send('EVENT_RECEIVED');

    for (const entry of req.body.entry) {
        const event = entry.messaging?.[0];
        const sid = event?.sender?.id;

        if (!sid || event.message?.is_echo) continue;

        const name = await getUserInfo(sid);

        // ─── Postback (أزرار) ───
        if (event.postback) {
            const payload = event.postback.payload;
            if (payload === 'GET_STARTED') {
                await sendWelcomeButtons(sid, name);
            } else if (payload === 'START_AI') {
                await sendServicesMenu(sid, name);
            } else if (serviceReplies[payload]) {
                await sendTyping(sid);
                await sleep(800);
                await sendMsg(sid, serviceReplies[payload]);
                if (buyRegex.test(serviceReplies[payload])) notifyAmmar(name, payload, sid);
            }
            continue;
        }

        // ─── رسالة نصية ───
        if (event.message?.text) {
            const userMsg = event.message.text;

            // كشف نية الشراء
            if (buyRegex.test(userMsg)) notifyAmmar(name, userMsg, sid);

            // ترحيب
            if (welcomeRegex.test(userMsg.trim())) {
                await sendWelcomeButtons(sid, name);
                continue;
            }

            // رد الـ AI
            await sendTyping(sid);
            const reply = await askGroq(userMsg, name, sid);
            await sleep(500);
            await sendMsg(sid, reply);
        }
    }
});

// ─── Webhook Verification ───
app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.send(req.query['hub.challenge']);
    else res.sendStatus(403);
});

app.get('/health', (req, res) => res.json({ status: 'ok', agency: 'ELAZ' }));

// ─── إعداد واجهة الصفحة ───
async function setupMessengerProfile() {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messenger_profile?access_token=${PAGE_ACCESS_TOKEN}`, {
            get_started: { payload: 'GET_STARTED' },
            greeting: [{ locale: 'default', text: 'أهلاً بحضرتك في وكالة ELAZ 🚀\nاضغط على (بدء الاستخدام) للتعرف على خدماتنا.' }],
            persistent_menu: [{
                locale: 'default',
                composer_input_disabled: false,
                call_to_actions: [
                    { type: 'postback', title: '📋 خدماتنا', payload: 'START_AI' },
                    { type: 'web_url', title: '💬 واتساب', url: MY_WHATSAPP_LINK }
                ]
            }]
        });
        console.log('✅ تم ضبط واجهة الصفحة بنجاح');
    } catch (e) { console.error('❌ فشل ضبط الواجهة:', e.message); }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 ELAZ System is LIVE!`);
    setupMessengerProfile();
});
