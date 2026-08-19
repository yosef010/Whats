global.crypto = require('crypto');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const axios = require('axios');
const express = require('express');
const QRCode = require('qrcode');

const app = express();
app.use(express.json()); // لتمكين السيرفر من قراءة بيانات JSON الواردة في الـ Body

const PORT = process.env.PORT || 8080;
let latestQR = '';
let sock = null; // متغير عام لحفظ كائن الاتصال بالواتساب

// 1. صفحة عرض الـ QR Code
app.get('/qr', async (req, res) => {
    if (!latestQR) {
        return res.send('<h2>جاري توليد الـ QR Code أو تم الاتصال بالفعل... قم بتحديث الصفحة.</h2>');
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

// 2. Endpoint جديدة لإرسال الردود من n8n إلى العميل
app.post('/send-message', async (req, res) => {
    const { to, message } = req.body;

    if (!to || !message) {
        return res.status(400).json({ status: 'error', error: 'تأكد من إرسال to و message في الـ body' });
    }

    if (!sock) {
        return res.status(500).json({ status: 'error', error: 'اتصال الواتساب غير جاهز حالياً' });
    }

    try {
        // التأكد من تنسيق الرقم بالشكل الصحيح لـ WhatsApp (مثال: 201xxxxxxxxx@s.whatsapp.net)
        const formattedJid = to.includes('@s.whatsapp.net') ? to : `${to.replace('+', '').trim()}@s.whatsapp.net`;
        
        await sock.sendMessage(formattedJid, { text: message });
        console.log(`📤 تم إرسال رد إلى ${formattedJid}: ${message}`);
        
        return res.json({ status: 'success', message: 'تم إرسال الرسالة بنجاح' });
    } catch (err) {
        console.error('❌ خطأ أثناء إرسال الرسالة:', err.message);
        return res.status(500).json({ status: 'error', error: err.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 السيرفر شغال على البورت ${PORT}`);
});

// 3. ربط Baileys بواتساب
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    sock = makeWASocket({
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
            latestQR = '';
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

                    const webhookUrl = process.env.WEBHOOK_URL || process.env.N8N_WEBHOOK_URL;
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
