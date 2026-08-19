global.crypto = require('crypto');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const axios = require('axios');
const express = require('express');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;
let latestQR = '';

// صفحة لعرض الـ QR كصورة واضحة
app.get('/qr', async (req, res) => {
    if (!latestQR) {
        return res.send('<h2>جاري توليد الـ QR Code أو تم الاتصال بالفعل... قم بتحديث الصفحة بعد ثوانٍ.</h2>');
    }
    try {
        const qrImage = await QRCode.toDataURL(latestQR);
        res.send(`
            <html>
                <body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#f0f2f5;">
                    <h2>افتح الواتساب واعمل Scan للـ QR Code:</h2>
                    <img src="${qrImage}" style="border:10px solid white;border-radius:8px;box-shadow:0 4px 10px rgba(0,0,0,0.1);" />
                </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send('خطأ في إنتاج الـ QR Code');
    }
});

app.listen(PORT, () => {
    console.log(`🌐 سيرفر الـ QR شغال على البورت ${PORT}`);
});

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    const sock = makeWASocket({
        auth: state,
        browser: ["Railway Bot", "Chrome", "1.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            latestQR = qr;
            console.log("\n=========================================");
            console.log("🔗 تم استخراج الـ QR! افتح رابط الصفحة لعمل Scan");
            console.log("=========================================\n");
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('انقطع الاتصال، جاري إعادة المحاولة...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            latestQR = ''; // إخفاء الـ QR بعد النجاح
            console.log('✅ تم الاتصال بحساب الواتساب بنجاح!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type === 'notify') {
            for (const msg of messages) {
                if (!msg.key.fromMe && msg.message) {
                    const sender = msg.key.remoteJid;
                    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

                    if (!text) continue;

                    console.log(`📥 رسالة من ${sender}: ${text}`);

                    const webhookUrl = process.env.WEBHOOK_URL;
                    if (webhookUrl) {
                        try {
                            await axios.post(webhookUrl, {
                                sender: sender,
                                message: text,
                                timestamp: msg.messageTimestamp
                            });
                            console.log('🚀 تم إرسال الرسالة للـ Webhook بنجاح');
                        } catch (err) {
                            console.error('❌ خطأ في الإرسال للـ Webhook:', err.message);
                        }
                    }
                }
            }
        }
    });
}

connectToWhatsApp();
