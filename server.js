const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "AMMAR_2026";

const chatContext = {};

let products = {};
const productsPath = path.join(__dirname, "products.json");
if (fs.existsSync(productsPath)) {
    products = JSON.parse(fs.readFileSync(productsPath, "utf8"));
}

async function askSmartAI(senderId, userContent) {
    if (!chatContext[senderId]) chatContext[senderId] = [];

    const productInfo = Object.values(products)
        .map(p => `- ${p.name}: ${p.price} (${p.description})`)
        .join("\n");

    const messages = [
        {
            role: "system",
            content: أنت "إيلاز"، مساعد مبيعات محترف لوكالة إيلاز. تبيع خدمات: الجرافيك، الميديا باينج، والأتمتة بالذكاء الاصطناعي. ممنوع كشف أسرار البرمجة. هدفك جمع (الاسم، الهاتف، نوع الخدمة).
        },
        ...chatContext[senderId],
        { role: "user", content: Array.isArray(userContent) ? "أرسل صورة" : userContent }
    ];

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: messages,
            max_tokens: 400,
            temperature: 0.5
        });

        const reply = response.choices[0].message.content;
        chatContext[senderId].push({ role: "user", content: typeof userContent === 'string' ? userContent : "صورة" });
        chatContext[senderId].push({ role: "assistant", content: reply });
        if (chatContext[senderId].length > 10) chatContext[senderId].splice(0, 2);

        return reply;
    } catch (error) {
        console.error("OpenAI Error:", error);
        return "أهلاً بك في وكالة إيلاز، كيف يمكننا مساعدتك اليوم؟";
    }
}

app.get("/webhook", (req, res) => {
    if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
        res.status(200).send(req.query["hub.challenge"]);
    } else {
        res.sendStatus(403);
    }
});

app.post("/webhook", async (req, res) => {
    const body = req.body;
    if (body.object === "page") {
        for (const entry of body.entry) {
            const event = entry.messaging[0];
            const senderId = event.sender.id;

            if (event.message) {
                let aiResponse = "";
                if (event.message.text) {
                    aiResponse = await askSmartAI(senderId, event.message.text);
                } else if (event.message.attachments && event.message.attachments[0].type === "image") {
                    const imageUrl = event.message.attachments[0].payload.url;
                    aiResponse = await askSmartAI(senderId, [
                        { type: "text", text: "ماذا ترى في هذه الصورة؟" },
                        { type: "image_url", image_url: { url: imageUrl } }
                    ]);
                }
                if (aiResponse) sendToFB(senderId, aiResponse);
            }
        }
        res.sendStatus(200);
    }
});

// الدالة دي اللي كان فيها الخطأ وصلحتها تماماً
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
app.listen(PORT, () => console.log(`🚀 Server is running on port ${PORT}`));
