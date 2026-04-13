async function askGroq(userMsg) {
    try {
        const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "system", content: "أنت إيلاز، مساعد ذكي مصري لوكالة ELAZ. ردك عامي ومختصر." }, { role: "user", content: userMsg }]
        }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });
        return res.data.choices[0].message.content;
    } catch (e) { return "اؤمرني يا فندم، محتاج تعرف إيه؟"; }
}

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.send(req.query['hub.challenge']);
    else res.send('Error');
});

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            let messaging = entry.messaging[0];
            let sid = messaging.sender.id;
            if (messaging.message && messaging.message.text) {
                const userMsg = messaging.message.text;
                if (/^(أهلا|اهلا|هلا|مرحبا|صباح|مساء|hi|hello)$/i.test(userMsg)) {
                    await sendTyping(sid);
                    await sleep(1000);
                    await sendButtons(sid, `أهلاً بك في ELAZ.. تحب تتواصل معانا إزاي؟`, [
                        { type: "postback", title: "تحدث مع إيلاز 🤖", payload: "START_AI" },
                        { type: "web_url", title: "خدمة العملاء 👤", url: MY_WHATSAPP_LINK }
                    ]);
                } else {
                    await sendTyping(sid);
                    const reply = await askGroq(userMsg);
                    await sendMsg(sid, reply);
                }
            }
            if (messaging.postback) {
                const p = messaging.postback.payload;
                if (p === 'START_AI') {
                    await sendTyping(sid);
                    await sendButtons(sid, `أنا إيلاز المساعد الذكي.. تحب تشوف "الخدمات"؟`, [{ type: "postback", title: "الخدمات 📋", payload: "SHOW_SERVICES" }]);
                }
                if (p === 'SHOW_SERVICES') { await sendTyping(sid); await sendServicesMenu(sid); }
            }
        }
        res.sendStatus(200);
    }
});
app.listen(process.env.PORT || 3000, () => console.log('Running!'));
