require('dotenv').config();
const express = require('express'), bodyParser = require('body-parser'), axios = require('axios');
const app = express().use(bodyParser.json());
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN, VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const MY_WHATSAPP_LINK = "https://wa.me/201557963125", sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function sendTyping(sid) {
    try { await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: sid }, sender_action: "typing_on" }); } catch (e) {}
}
async function sendMsg(sid, text) {
    try { await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: sid }, message: { text: text } }); } catch (e) {}
}
async function sendButtons(sid, text, buttons) {
    try { await axios.post(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: sid }, message: { attachment: { type: "template", payload: { template_type: "button", text: text, buttons: buttons } } } }); } catch (e) {}
}

// زرار واتساب - بيتبعت بعد كل خدمة
async function sendWhatsAppButton(sid) {
    await sendButtons(sid, "تحب تتواصل معنا أو تعرف أكتر؟", [
        { type: "web_url", title: "👤 تواصل على واتساب", url: MY_WHATSAPP_LINK },
        { type: "postback", title: "📋 عرض الخدمات", payload: "SHOW_SERVICES" }
    ]);
}

// قائمة الخدمات الرئيسية
async function sendServicesMenu(sid) {
    await sendButtons(sid, `اتفضل يا فندم، دي الخدمات اللي بنقدمها في ELAZ:`, [
        { type: "postback", title: "🎨 هوية بصرية", payload: "SRV_DESIGN" },
        { type: "postback", title: "📢 إعلانات ممولة", payload: "SRV_ADS" },
        { type: "postback", title: "🤖 بوتات ذكية", payload: "SRV_BOTS" }
    ]);
}

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.send(req.query['hub.challenge']);
    else res.send('Error');
});

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            let messaging = entry.messaging[0], sid = messaging.sender.id;

            // تجاهل echo messages (رسائل الصفحة نفسها)
            if (messaging.message?.is_echo) continue;

            if (messaging.message && messaging.message.text) {
                await sendTyping(sid); await sleep(500);
                await sendButtons(sid, `أهلاً بك في وكالة ELAZ للتسويق والتصميم.. تحب تبدأ بإيه؟`, [
                    { type: "postback", title: "📋 استعراض الخدمات", payload: "SHOW_SERVICES" },
                    { type: "web_url", title: "👤 خدمة العملاء", url: MY_WHATSAPP_LINK }
                ]);
            }

            if (messaging.postback) {
                const p = messaging.postback.payload;
                await sendTyping(sid); await sleep(400);

                if (p === 'SHOW_SERVICES') {
                    await sendServicesMenu(sid);
                }

                if (p === 'SRV_DESIGN') {
                    await sendMsg(sid, "🎨 بنقدم تصميم لوجو، هوية بصرية كاملة، وتصاميم سوشيال ميديا باحترافية.\n\nتحب تشوف سابقة أعمالنا؟ تواصل معنا دلوقتي!");
                    await sleep(300);
                    await sendWhatsAppButton(sid);
                }

                if (p === 'SRV_ADS') {
                    await sendMsg(sid, "📢 بنعمل حملات إعلانية على فيسبوك وإنستجرام وتيك توك بهدف تحقيق أعلى مبيعات (Leads).\n\nتحب نعمل لك استشارة مجانية؟");
                    await sleep(300);
                    await sendWhatsAppButton(sid);
                }

                if (p === 'SRV_BOTS') {
                    await sendMsg(sid, "🤖 بنصمم بوتات ذكية لردود تلقائية وتوفير وقتك وزيادة مبيعاتك.\n\nزي البوت اللي بتكلمه دلوقتي 😄");
                    await sleep(300);
                    await sendWhatsAppButton(sid);
                }
            }
        }
        res.sendStatus(200);
    }
});

app.listen(process.env.PORT || 3000, () => console.log('ELAZ Bot Live ✅'));
