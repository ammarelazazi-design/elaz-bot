const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "AMMAR_2026";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;   // مهم: هتحطه في Secrets

// تحميل المنتجات
let products = {};
const productsPath = path.join(__dirname, "products.json");

function loadProducts() {
  try {
    const data = fs.readFileSync(productsPath, "utf8");
    products = JSON.parse(data);
    console.log(`✅ تم تحميل ${Object.keys(products).length} منتج`);
  } catch (err) {
    console.error("❌ خطأ في products.json:", err.message);
  }
}

loadProducts();

// Webhook Verification (GET)
app.get("/webhook", (req, res) => {
    if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
        console.log("✅ Webhook verified!");
        res.status(200).send(req.query["hub.challenge"]);
    } else {
        res.sendStatus(403);
    }
});

// استقبال الرسائل (POST)
app.post("/webhook", (req, res) => {
    const body = req.body;
    if (body.object === "page") {
        body.entry.forEach(entry => {
            const event = entry.messaging ? entry.messaging[0] : null;
            if (event) handleEvent(event);
        });
        res.sendStatus(200);
    } else {
        res.sendStatus(404);
    }
});

function handleEvent(event) {
    const senderId = event.sender.id;

    if (event.message && event.message.text) {
        const text = event.message.text.trim().toLowerCase();

        if (text.includes("مرحبا") || text.includes("hi") || text === "") {
            sendWelcomeMessage(senderId);
            return;
        }

        let foundProduct = null;
        for (let key in products) {
            if (text === key || text.includes(products[key].name.toLowerCase())) {
                foundProduct = products[key];
                break;
            }
        }

        if (foundProduct) {
            sendProductDetails(senderId, foundProduct);
        } else if (text.includes("منتجات") || text.includes("عرض")) {
            sendProductsList(senderId);
        } else {
            sendTextMessage(senderId, "👋 مرحبا بك في **إيلاز**!\nاكتب 'منتجات' أو اسم المنتج.");
        }
    }
}

function sendWelcomeMessage(recipientId) {
    const messageData = {
        recipient: { id: recipientId },
        message: {
            text: "👋 مرحبا بك في **إيلاز**!\nمتجر الإكسسوارات التقنية 🔥\nكيف نقدر نساعدك؟",
            quick_replies: [
                { content_type: "text", title: "🛍️ عرض المنتجات", payload: "PRODUCTS" }
            ]
        }
    };
    callSendAPI(messageData);
}

function sendProductsList(recipientId) {
    let text = "🛍️ **منتجات إيلاز**\n\n";
    Object.keys(products).forEach(key => {
        const p = products[key];
        text += `${key} → ${p.name} | ${p.price}\n`;
    });
    text += "\nاكتب رقم أو اسم المنتج";
    sendTextMessage(recipientId, text);
}

function sendProductDetails(recipientId, product) {
    sendTextMessage(recipientId, `✅ **${product.name}**\n💰 ${product.price}\n📝 ${product.description}`);
}

function sendTextMessage(recipientId, text) {
    callSendAPI({
        recipient: { id: recipientId },
        message: { text: text }
    });
}

function callSendAPI(messageData) {
    if (!PAGE_ACCESS_TOKEN) {
        console.error("❌ PAGE_ACCESS_TOKEN مش موجود في Secrets");
        return;
    }
    fetch(`https://graph.facebook.com/v20.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(messageData)
    })
    .then(res => res.json())
    .then(data => console.log("✅ Message sent"))
    .catch(err => console.error("❌", err));
}

// تشغيل السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 البوت شغال على بورت ${PORT}`);
    console.log(`🔗 Webhook URL: ${process.env.REPLIT_DEPLOYMENT ? 'https://' + process.env.REPLIT_SLUG + '.replit.app' : 'localhost'}/webhook`);
});