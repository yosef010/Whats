global.crypto = require('crypto');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const axios = require('axios');
const express = require('express');
const QRCode = require('qrcode');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
let latestQR = '';
let sock = null;

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

// 2. Endpoint لإرسال الرد من n8n للواتساب
app.post('/send-message', async (req, res) => {
    const { to, message } = req.body;

    if (!to || !message) {
        return res.status(400).json({ status: 'error', error: 'تأكد من إرسال to و message' });
    }

    if (!sock || !sock.user) {
        return res.status(503).json({ status: 'error', error: 'البوت غير متصل حالياً' });
    }

    try {
        let formattedJid = to.toString().trim();
        if (!formattedJid.includes('@')) {
            const cleanNumber = formattedJid.replace(/[^0-9]/g, '');
            formattedJid = `${cleanNumber}@s.whatsapp.net`;
        }
        
        await sock.sendMessage(formattedJid, { text: message });
        console.log(`📤 تم الإرسال إلى ${formattedJid}`);
        return res.json({ status: 'success', message: 'تم الإرسال بنجاح' });
    } catch (err) {
        return res.status(500).json({ status: 'error', error: err.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 السيرفر شغال على البورت ${PORT}`);
});

// 3. دالة الاتصال الرئيسية
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    sock = makeWASocket({
        auth: state,
        browser: ["Railway Bot", "Chrome", "1.0.0"],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) latestQR = qr;

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('⚠️ انقطع الاتصال، جاري إعادة المحاولة...', shouldReconnect);
            if (shouldReconnect) setTimeout(connectToWhatsApp, 5000);
        } else if (connection === 'open') {
            latestQR = '';
            console.log('✅ تم الاتصال بنجاح!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (msg.key.fromMe || !msg.message) continue;

            const senderJid = msg.key.remoteJid;
            if (senderJid.endsWith('@g.us')) continue;

            // استخراج النص والصورة
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
            const isImage = !!msg.message.imageMessage;
            let base64Image = null;

            if (isImage) {
                try {
                    const stream = await downloadContentFromMessage(msg.message.imageMessage, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                    base64Image = `data:image/jpeg;base64,${buffer.toString('base64')}`;
                } catch (err) { console.error('خطأ تحميل الصورة:', err); }
            }

            // إرسال البيانات فوراً للـ Webhook
            const webhookUrl = process.env.WEBHOOK_URL || process.env.N8N_WEBHOOK_URL;
            if (webhookUrl) {
                try {
                    await axios.post(webhookUrl, {
                        sender: senderJid,
                        phone: senderJid.split('@')[0],
                        message: text,
                        image: base64Image,
                        timestamp: msg.messageTimestamp
                    });
                    console.log(`🚀 تم الإرسال للـ Webhook فوراً`);
                } catch (err) { console.error('خطأ في Webhook:', err.message); }
            }
        }
    });
}

connectToWhatsApp();
