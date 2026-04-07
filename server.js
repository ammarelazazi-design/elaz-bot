const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.json());

// جلب المفاتيح من بيئة العمل في Render
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "AMMAR_2026";

// رابط التحقق لفيسبوك (Webhook Verification)
app.get("/webhook", (req, res) => {
    if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
        res.status(200).send(req.query["hub.challenge"]);
    } else {
        res.sendStatus(403);
    }
});

// استقبال الرسائل ومعالجتها بالذكاء الاصطناعي
app.post("/webhook", async (req, res) => {
    const body = req.body;
    if (body.object === "page") {
        for (const entry of body.entry) {
            if (entry.messaging) {
                const event = entry.messaging[0];
                const senderId = event.sender.id;
                
                if (event.message && event.message.text) {
                    try {
                        const response = await openai.chat.completions.create({
                            model: "gpt-4o",
                            messages: [
                                { role: "system", content: "أنت إيلاز، مساعد وكالة إيلاز للتسويق والذكاء الاصطناعي. ردك مهني، ذكي، وهدفك مساعدة العميل في خدمات الجرافيك والميديا باينج." },
                                { role: "user", content: event.message.text }
                            ]
                        });
                        
                        const aiReply = response.choices[0].message.content;
                        sendToFB(senderId, aiReply);
                    } catch (e) {
                        console.error("AI Error:", e.message);
                    }
                }
            }
        }
        res.sendStatus(200);
    }
});

// دالة إرسال الرد لفيسبوك
function sendToFB(recipientId, text) {
    const url = "https://graph.facebook.com/v20.0/me/messages?access_token=" + PAGE_ACCESS_TOKEN;
    fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            recipient: { id: recipientId },
            message: { text: text }
        })
    }).catch(err => console.error("FB Send Error:", err));
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server Live 🚀"));
