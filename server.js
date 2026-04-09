const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const crypto = require('crypto');

// ═══════════════════════════════════════════
//  إعداد السيرفر
// ═══════════════════════════════════════════
const app = express().use(bodyParser.json());

// المفاتيح من Render Environment Variables
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN;
const GROQ_API_KEY      = process.env.GROQ_API_KEY;
const ZAPIER_WEBHOOK_URL = process.env.ZAPIER_WEBHOOK_URL;
const APP_SECRET        = process.env.APP_SECRET;       // من إعدادات Facebook App
const AMMAR_PSID        = process.env.AMMAR_PSID;       // PSID الخاص بعمار

// ═══════════════════════════════════════════
//  حفظ سياق المحادثة (آخر 10 رسائل لكل عميل)
// ═══════════════════════════════════════════
const conversations = new Map();

function getHistory(psid) {
    return conversations.get(psid) || [];
}

function addToHistory(psid, role, content) {
    const history = getHistory(psid);
    history.push({ role, content });
    // احتفظ بآخر 10 رسائل فقط (5 من كل طرف) لتوفير tokens
    if (history.length > 10) history.splice(0, 2);
    conversations.set(psid, history);
}

// ═══════════════════════════════════════════
//  1. إعداد واجهة الصفحة (بتشتغل مرة واحدة)
// ═══════════════════════════════════════════
async function setupMessengerProfile() {
    try {
        await axios.post(
            `https://graph.facebook.com/v19.0/me/messenger_profile?access_token=${PAGE_ACCESS_TOKEN}`,
            {
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
            }
        );
        console.log('✅ تم ضبط واجهة الصفحة بنجاح');
    } catch (e) {
        console.error('❌ فشل ضبط الواجهة:', e.response?.data || e.message);
    }
}

// ═══════════════════════════════════════════
//  2. جلب اسم العميل (مع cache بسيط)
// ═══════════════════════════════════════════
const nameCache = new Map();

async function getUserInfo(psid) {
    if (nameCache.has(psid)) return nameCache.get(psid);
    try {
        const res = await axios.get(
            `https://graph.facebook.com/${psid}?fields=first_name&access_token=${PAGE_ACCESS_TOKEN}`
        );
        const name = res.data.first_name || 'عزيزي العميل';
        nameCache.set(psid, name);
        return name;
    } catch (e) {
        return 'عزيزي العميل';
    }
}

// ═══════════════════════════════════════════
//  3. التحقق من Facebook Signature (أمان)
// ═══════════════════════════════════════════
function verifySignature(req) {
    if (!APP_SECRET) return true; // لو مش محطط للأمان دلوقتي
    const sig = req.headers['x-hub-signature-256'];
    if (!sig) return false;
    const expected = 'sha256=' + crypto
        .createHmac('sha256', APP_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

// ═══════════════════════════════════════════
//  4. Typing Indicator (يظهر "جاري الكتابة")
// ═══════════════════════════════════════════
async function sendTyping(sid) {
    try {
        await axios.post(
            `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            { recipient: { id: sid }, sender_action: 'typing_on' }
        );
    } catch (e) {}
}

// ═══════════════════════════════════════════
//  5. دالة إرسال الرسائل (مع retry واحدة)
// ═══════════════════════════════════════════
async function sendMsg(sid, text) {
    try {
        await axios.post(
            `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            { recipient: { id: sid }, message: { text } }
        );
    } catch (e) {
        // محاولة ثانية بعد ثانيتين
        try {
            await new Promise(r => setTimeout(r, 2000));
            await axios.post(
                `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
                { recipient: { id: sid }, message: { text } }
            );
        } catch (e2) {
            console.error('❌ فشل إرسال رسالة لـ', sid, e2.response?.data);
        }
    }
}

// ═══════════════════════════════════════════
//  6. إرسال Quick Replies (أزرار سريعة)
// ═══════════════════════════════════════════
async function sendQuickReplies(sid, text, replies) {
    try {
        await axios.post(
            `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            {
                recipient: { id: sid },
                message: {
                    text,
                    quick_replies: replies.map(r => ({
                        content_type: 'text',
                        title: r.title,
                        payload: r.payload
                    }))
                }
            }
        );
    } catch (e) {
        // fallback: بعت رسالة عادية
        await sendMsg(sid, text);
    }
}

// ═══════════════════════════════════════════
//  7. محرك الذكاء الاصطناعي (Groq) مع سياق
// ═══════════════════════════════════════════
const SYSTEM_PROMPT = `أنت مساعد وكالة ELAZ للتسويق الرقمي والذكاء الاصطناعي.
خدماتنا:
- تصميم جرافيك واحترافي (سوشيال ميديا، هوية بصرية، إعلانات)
- إعلانات ممولة على فيسبوك وإنستجرام وجوجل
- بوتات واتساب وماسنجر وحلول ذكاء اصطناعي للشركات

قواعد الرد:
- رد دايماً بلهجة مصرية محترمة ومختصرة (3-5 جمل كحد أقصى)
- لو سأل عن سعر أو تكلفة أو ميعاد: قوله إن أستاذ عمار هيكلمه شخصياً عشان يحدد معاه أنسب حل
- لو سأل عن حاجة مش من اختصاصنا: اعتذر بلطف وقوله إيه اللي بتقدر تعمله ليه
- لا تقول أرقام أسعار أبداً
- ابدأ دايماً بالاسم لو عندك`;

async function askGroq(userMsg, firstName, psid) {
    const history = getHistory(psid);

    // أضف رسالة العميل للتاريخ
    addToHistory(psid, 'user', userMsg);

    try {
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: 'llama-3.3-70b-versatile',
                max_tokens: 300,
                messages: [
                    { role: 'system', content: `${SYSTEM_PROMPT}\nاسم العميل: ${firstName}` },
                    ...getHistory(psid) // يشمل الرسالة الجديدة
                ]
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );

        const aiReply = response.data.choices[0].message.content;

        // أضف رد الـ AI للتاريخ
        addToHistory(psid, 'assistant', aiReply);

        return aiReply;
    } catch (e) {
        console.error('❌ Groq error:', e.response?.data || e.message);
        return `وصلت رسالتك يا ${firstName}، أستاذ عمار هيتواصل معاك حالاً 🙏`;
    }
}

// ═══════════════════════════════════════════
//  8. معالجة الـ Postbacks (الأزرار)
// ═══════════════════════════════════════════
const postbackResponses = {
    START_ELAZ: async (sid, firstName) => {
        await sendQuickReplies(
            sid,
            `أهلاً بيك يا ${firstName} في إيلاز! 🚀\nإحنا بنساعد الشركات تكبر من خلال:\n- تصميم احترافي\n- إعلانات ممولة\n- حلول ذكاء اصطناعي\n\nإيه اللي بتحتاجه؟`,
            [
                { title: '🎨 تصميم', payload: 'SERVICE_DESIGN' },
                { title: '📢 إعلانات', payload: 'SERVICE_ADS' },
                { title: '🤖 بوتات', payload: 'SERVICE_BOTS' },
                { title: '💰 الأسعار', payload: 'PRICING' }
            ]
        );
    },
    SERVICE_DESIGN: async (sid, firstName) => {
        await sendMsg(sid, `تصميمنا يا ${firstName} بيشمل:\n✅ هوية بصرية كاملة\n✅ تصميمات سوشيال ميديا\n✅ إعلانات وبانرات احترافية\n✅ مطبوعات بكل أنواعها\n\nكل التصميمات بتتعمل في أقل وقت وأعلى جودة 🎯`);
    },
    SERVICE_ADS: async (sid, firstName) => {
        await sendMsg(sid, `إعلاناتنا بتوصّلك للعميل الصح يا ${firstName}:\n✅ فيسبوك وإنستجرام\n✅ جوجل وYouTube\n✅ إدارة كاملة للحملات\n✅ تقارير أسبوعية\n\nبنركز على النتيجة مش بس الوصول 📈`);
    },
    SERVICE_BOTS: async (sid, firstName) => {
        await sendMsg(sid, `حلول الذكاء الاصطناعي عندنا يا ${firstName}:\n✅ بوتات ماسنجر وواتساب\n✅ ردود آلية ذكية\n✅ ربط مع أنظمة البيع\n✅ لوحة تحكم كاملة\n\nبوتات بتشتغل 24/7 بدونك 🤖`);
    },
    PRICING: async (sid, firstName) => {
        await sendMsg(sid, `الأسعار بتختلف يا ${firstName} حسب حجم الشغل والمدة.\n\nأستاذ عمار هيكلمك شخصياً ويعمل معاك عرض مناسب لاحتياجاتك بالظبط 💬\n\nهنتواصل معاك في أقرب وقت!`);
        notifyAmmar(firstName, 'عايز يعرف الأسعار', sid);
    },
    CONTACT: async (sid, firstName) => {
        await sendMsg(sid, `هيتم التواصل معاك يا ${firstName} في أقرب وقت ممكن ⚡\n\nأستاذ عمار شخصياً هيكلمك ويسمع منك.`);
        notifyAmmar(firstName, 'طلب تواصل مباشر', sid);
    }
};

// ═══════════════════════════════════════════
//  9. تنبيه عمار + Zapier
// ═══════════════════════════════════════════
function notifyAmmar(firstName, message, psid) {
    // تنبيه شخصي لعمار على الماسنجر
    if (AMMAR_PSID) {
        sendMsg(AMMAR_PSID, `🚨 عميل محتاج تواصل:\nالاسم: ${firstName}\nالرسالة: "${message}"\nالـ PSID: ${psid}`);
    }
    // إرسال لـ Zapier (بدون await عشان متبطلش الرد)
    if (ZAPIER_WEBHOOK_URL) {
        axios.post(ZAPIER_WEBHOOK_URL, {
            name: firstName,
            message,
            psid,
            time: new Date().toLocaleString('ar-EG')
        }).catch(() => {});
    }
}

// كلمات تشير لنية الشراء أو السؤال عن الأسعار
const BUY_INTENT = /سعر|بكام|ميعاد|احجز|كام|تكلفة|عرض|اشتراك|ازاي نبدأ|عايز اشتغل|نبدأ ازاي|فلوس|دفع|باكدج|package/i;

// ═══════════════════════════════════════════
//  10. الـ Webhook الرئيسي
// ═══════════════════════════════════════════
app.post('/webhook', async (req, res) => {
    // التحقق من Facebook Signature
    if (!verifySignature(req)) {
        console.warn('⚠️ Invalid signature - rejected request');
        return res.sendStatus(403);
    }

    const body = req.body;
    if (body.object !== 'page') return res.sendStatus(404);

    // رد فوري على Facebook عشان ما يعيدش الطلب
    res.status(200).send('EVENT_RECEIVED');

    for (const entry of body.entry) {
        const event = entry.messaging?.[0];
        const sid = event?.sender?.id;

        // تجاهل رسائلنا الـ echo أو PSID عمار نفسه
        if (!sid || sid === AMMAR_PSID) continue;

        const firstName = await getUserInfo(sid);

        // ─── Postback (ضغط على زر) ───
        if (event.postback) {
            const payload = event.postback.payload;
            const handler = postbackResponses[payload];
            if (handler) {
                await handler(sid, firstName);
            } else {
                // postback مش معروف — ردّ بالـ AI
                await sendTyping(sid);
                const reply = await askGroq(event.postback.title || payload, firstName, sid);
                await sendMsg(sid, reply);
            }
            continue;
        }

        // ─── رسالة نصية ───
        if (event.message?.text && !event.message.is_echo) {
            const userMsg = event.message.text.trim();

            // كشف نية الشراء
            if (BUY_INTENT.test(userMsg)) {
                notifyAmmar(firstName, userMsg, sid);
            }

            // إظهار "جاري الكتابة"
            await sendTyping(sid);

            // الرد بالـ AI مع السياق
            const aiReply = await askGroq(userMsg, firstName, sid);
            await sendMsg(sid, aiReply);
        }
    }
});

// ═══════════════════════════════════════════
//  التحقق من الـ Webhook (GET)
// ═══════════════════════════════════════════
app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        res.sendStatus(403);
    }
});

// ═══════════════════════════════════════════
//  Health Check (للـ Render uptime monitoring)
// ═══════════════════════════════════════════
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        conversations: conversations.size,
        cachedNames: nameCache.size
    });
});

// ═══════════════════════════════════════════
//  تشغيل السيرفر
// ═══════════════════════════════════════════
app.listen(process.env.PORT || 3000, () => {
    console.log('🚀 ELAZ Bot is LIVE!');
    setupMessengerProfile();
});
