const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express().use(bodyParser.json());

const PAGE_ACCESS_TOKEN  = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN       = process.env.VERIFY_TOKEN;
const GROQ_API_KEY       = process.env.GROQ_API_KEY;
const ZAPIER_WEBHOOK_URL = process.env.ZAPIER_WEBHOOK_URL;
const AMMAR_PSID         = process.env.AMMAR_PSID;

// ═══════════════════════════════════════════
//  حفظ سياق المحادثة
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
//  إعداد واجهة الصفحة
// ═══════════════════════════════════════════
async function setupMessengerProfile() {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messenger_profile?access_token=${PAGE_ACCESS_TOKEN}`, {
            get_started: { payload: 'START_ELAZ' },
            greeting: [{ locale: 'default', text: 'أهلاً بيك في إيلاز 🚀\nبنساعدك تكبر شغلك وتزود مبيعاتك.\n\nدوس على (بدء الاستخدام) وخلينا نبدأ.' }],
            persistent_menu: [{
                locale: 'default',
                composer_input_disabled: false,
                call_to_actions: [
                    { type: 'postback', title: '🎨 تصميم احترافي',       payload: 'SERVICE_DESIGN' },
                    { type: 'postback', title: '📢 إعلانات ممولة',        payload: 'SERVICE_ADS'    },
                    { type: 'postback', title: '🤖 بوتات وذكاء اصطناعي', payload: 'SERVICE_BOTS'   },
                    { type: 'postback', title: '💰 الأسعار والعروض',      payload: 'PRICING'        },
                    { type: 'postback', title: '📞 تواصل مع فريقنا',      payload: 'CONTACT'        }
                ]
            }]
        });
        console.log('✅ تم ضبط واجهة الصفحة بنجاح');
    } catch (e) { console.error('❌ فشل ضبط الواجهة:', e.message); }
}

// ═══════════════════════════════════════════
//  جلب اسم العميل
// ═══════════════════════════════════════════
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
//  إرسال الرسائل
// ═══════════════════════════════════════════
async function sendTyping(sid) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            { recipient: { id: sid }, sender_action: 'typing_on' });
    } catch (e) {}
}

async function sendMsg(sid, text) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            { recipient: { id: sid }, message: { text } });
    } catch (e) { console.error('❌ فشل إرسال رسالة:', e.response?.data); }
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
//  الذكاء الاصطناعي (Groq)
// ═══════════════════════════════════════════
const SYSTEM_PROMPT = `أنت مساعد وكالة ELAZ للتسويق الرقمي والذكاء الاصطناعي.
خدماتنا:
- تصميم جرافيك: هوية بصرية، لوجو، منشورات سوشيال ميديا
- إعلانات ممولة: فيسبوك، إنستجرام، جوجل
- بوتات وذكاء اصطناعي: ماسنجر، واتساب، أتمتة
- مواقع إلكترونية: سريعة ومتوافقة مع SEO

قواعد الرد:
- رد بلهجة مصرية محترمة ومختصرة (3-4 جمل بحد أقصى)
- لو سأل عن سعر أو تكلفة: قوله أستاذ عمار هيكلمه شخصياً
- لا تذكر أرقام أسعار أبداً`;

async function askGroq(userMsg, firstName, psid) {
    addToHistory(psid, 'user', userMsg);
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'llama-3.3-70b-versatile',
            max_tokens: 300,
            messages: [
                { role: 'system', content: `${SYSTEM_PROMPT}\nاسم العميل: ${firstName}` },
                ...getHistory(psid)
            ]
        }, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });

        const aiReply = response.data.choices[0].message.content;
        addToHistory(psid, 'assistant', aiReply);
        return aiReply;
    } catch (e) {
        console.error('❌ Groq error:', e.response?.data || e.message);
        return `وصلت رسالتك يا ${firstName}، أستاذ عمار هيتواصل معاك حالاً 🙏`;
    }
}

// ═══════════════════════════════════════════
//  تنبيه عمار
// ═══════════════════════════════════════════
function notifyAmmar(name, msg, psid) {
    if (AMMAR_PSID) sendMsg(AMMAR_PSID, `🚨 عميل محتاج تواصل:\nالاسم: ${name}\nالرسالة: "${msg}"`);
    if (ZAPIER_WEBHOOK_URL) axios.post(ZAPIER_WEBHOOK_URL, { name, msg, psid, time: new Date().toLocaleString('ar-EG') }).catch(() => {});
}

// ═══════════════════════════════════════════
//  الأزرار (Postbacks)
// ═══════════════════════════════════════════
const postbackResponses = {
    START_ELAZ: async (sid, name) => {
        await sendQuickReplies(sid,
            `أهلاً بيك يا ${name} في إيلاز! 🚀\nبنساعدك تكبر شغلك من خلال التصميم والإعلانات وبوتات الذكاء الاصطناعي.\n\nمحتاج مساعدة في إيه؟`,
            [
                { title: '🎨 تصميم',   payload: 'SERVICE_DESIGN' },
                { title: '📢 إعلانات', payload: 'SERVICE_ADS'    },
                { title: '🤖 بوتات',   payload: 'SERVICE_BOTS'   },
                { title: '💰 الأسعار', payload: 'PRICING'        }
            ]
        );
    },
    SERVICE_DESIGN: async (sid, name) => await sendMsg(sid, `تصميماتنا يا ${name} بتشمل:\n✅ هوية بصرية كاملة\n✅ لوجو احترافي\n✅ تصاميم سوشيال ميديا\n✅ مطبوعات بكل أنواعها\n\nكل ده بأعلى جودة وأقصر وقت 🎯`),
    SERVICE_ADS:    async (sid, name) => await sendMsg(sid, `إعلاناتنا يا ${name} بتوصلك للعميل الصح:\n✅ فيسبوك وإنستجرام\n✅ جوجل وYouTube\n✅ إدارة كاملة للحملات\n✅ تقارير دورية\n\nبنركز على النتيجة مش بس الوصول 📈`),
    SERVICE_BOTS:   async (sid, name) => await sendMsg(sid, `بوتاتنا يا ${name} بتشتغل 24/7:\n✅ ماسنجر وواتساب\n✅ ردود ذكية بالذكاء الاصطناعي\n✅ ربط مع أنظمة البيع\n✅ لوحة تحكم كاملة 🤖`),
    PRICING: async (sid, name) => {
        await sendMsg(sid, `الأسعار بتختلف يا ${name} حسب حجم الشغل.\nأستاذ عمار هيكلمك شخصياً ويعمل معاك أنسب عرض 💬`);
        notifyAmmar(name, 'بيسأل عن الأسعار', sid);
    },
    CONTACT: async (sid, name) => {
        await sendMsg(sid, `تمام يا ${name}، أستاذ عمار هيتواصل معاك فوراً ⚡`);
        notifyAmmar(name, 'طلب تواصل مباشر', sid);
    }
};

// ═══════════════════════════════════════════
//  Webhook الرئيسي
// ═══════════════════════════════════════════
app.post('/webhook', async (req, res) => {
    if (req.body.object !== 'page') return res.sendStatus(404);
    res.status(200).send('EVENT_RECEIVED');

    const event = req.body.entry?.[0]?.messaging?.[0];
    const sid = event?.sender?.id;
    if (!sid || sid === AMMAR_PSID) return;

    const name = await getUserInfo(sid);

    if (event.postback) {
        const handler = postbackResponses[event.postback.payload];
        if (handler) await handler(sid, name);
        else {
            await sendTyping(sid);
            await sendMsg(sid, await askGroq(event.postback.title || '', name, sid));
        }
        return;
    }

    if (event.message?.text && !event.message.is_echo) {
        const text = event.message.text;
        if (/سعر|بكام|تكلفة|عرض|ازاي نبدأ|باكدج/i.test(text)) notifyAmmar(name, text, sid);
        await sendTyping(sid);
        await sendMsg(sid, await askGroq(text, name, sid));
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
