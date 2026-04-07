const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(bodyParser.json());

// إعداد Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "AMMAR_2026";

app.get("/webhook", (req, res) => {
    if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
        res.status(200).send(req.query["hub.challenge"]);
    } else { res.sendStatus(403); }
});

app.post("/webhook", async (req, res) => {
    const body = req.body;
    if (body.object === "page") {
        for (const entry of body.entry) {
            if (entry.messaging) {
                const event = entry.messaging[0];
                const senderId = event.sender.id;
                if (event.message && event.message.text) {
                    try {
                        // طلب الرد من Gemini
                        const prompt = "أنت إيلاز، مساعد وكالة إيلاز للتسويق. رد باحترافية واختصار: " + event.message.text;
                        const result = await model.generateContent(prompt);
                        const aiReply = result.response.text();
                        
                        sendToFB(senderId, aiReply);
                    } catch (e) { console.error("Gemini Error:", e); }
                }
            }
        }
        res.sendStatus(200);
    }
});

function sendToFB(recipientId, text) {
    fetch("https://graph.facebook.com/v20.0/me/messages?access_token=" + PAGE_ACCESS_TOKEN, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: { id: recipientId }, message: { text: text } })
    });
}

app.listen(process.env.PORT || 3000, () => console.log("Gemini Bot Live 🚀"));
