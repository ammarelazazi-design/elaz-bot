App.post('/webhook', async (req, res) => {
    let body = req.body;

    if (body.object === 'page') {
        for (const entry of body.entry) {
            const webhook_event = entry.messaging?.[0];
            if (!webhook_event) continue;

            const sender_psid = webhook_event.sender.id;

            // منع الـ echo
            if (webhook_event.message?.is_echo) continue;

            if (webhook_event.message && webhook_event.message.text) {
                const userMessage = webhook_event.message.text;

                try {
                    const model = "gemini-2.0-flash";   // غيّر هنا لو عايز model تاني

                    const geminiResponse = await axios.post(
                        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
                        {
                            contents: [{
                                role: "user",
                                parts: [{ text: userMessage }]
                            }]
                        }
                    );

                    const candidate = geminiResponse.data.candidates?.[0];
                    const aiResponse = candidate?.content?.parts?.[0]?.text 
                        || "عفواً، مش قادر أرد دلوقتي.";

                    await callSendAPI(sender_psid, aiResponse);

                } catch (error) {
                    console.error("Gemini Error:", error.response?.data || error.message);
                    const errorMsg = error.response?.data ? 
                        JSON.stringify(error.response.data).slice(0, 200) : 
                        error.message;

                    await callSendAPI(sender_psid, `عطل في الـ AI: ${errorMsg}`);
                }
            }
        }

        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});
