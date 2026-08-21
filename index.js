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

app.get('/qr', async (req, res) => {
    if (!latestQR) return res.send('<h2>جاري توليد الـ QR Code أو تم الاتصال بالفعل... قم بتحديث الصفحة.</h2>');
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
    } catch (err) { res.status(500).send('خطأ في إنتاج الـ QR Code'); }
});

app.post('/send-message', async (req, res) => {
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ status: 'error', error: 'تأكد من إرسال to و message' });
    if (!sock || !sock.user) return res.status(503).json({ status: 'error', error: 'البوت غير متصل حالياً' });

    try {
        let formattedJid = to.toString().trim();
        if (!formattedJid.includes('@')) {
            const cleanNumber = formattedJid.replace(/[^0-9]/g, '');
            formattedJid = `${cleanNumber}@s.whatsapp.net`;
        }
        await sock.sendMessage(formattedJid, { text: message });
        return res.json({ status: 'success', message: 'تم الإرسال بنجاح' });
    } catch (err) { return res.status(500).json({ status: 'error', error: err.message }); }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🌐 السيرفر شغال على البورت ${PORT}`));

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
            if (shouldReconnect) setTimeout(connectToWhatsApp, 5000);
        } else if (connection === 'open') {
            latestQR = '';
            console.log('✅ تم الاتصال بنجاح!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            try {
                if (!msg || msg.key.fromMe || !msg.message) continue;
                const senderJid = msg.key.remoteJid;
                if (!senderJid || senderJid.endsWith('@g.us')) continue;

                const msgContent = msg.message;

                // 1. استخراج النص أو الـ Caption
                const text = msgContent.conversation || 
                             msgContent.extendedTextMessage?.text || 
                             msgContent.imageMessage?.caption || 
                             msgContent.videoMessage?.caption || '';

                const imageMsg = msgContent.imageMessage;
                const audioMsg = msgContent.audioMessage || msgContent.pttMessage;

                let msgType = 'text'; // الافتراضي: نص
                let mediaBase64 = null;
                let mimeType = null;

                // 2. تحديد النوع وتنزيل الميديا
                if (imageMsg) {
                    msgType = 'image';
                    try {
                        const stream = await downloadContentFromMessage(imageMsg, 'image');
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                        mediaBase64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
                        mimeType = 'image/jpeg';
                    } catch (e) { console.error('خطأ صورة:', e.message); }
                } else if (audioMsg) {
                    msgType = 'audio';
                    try {
                        const stream = await downloadContentFromMessage(audioMsg, 'audio');
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                        mediaBase64 = `data:audio/ogg;base64,${buffer.toString('base64')}`;
                        mimeType = 'audio/ogg';
                    } catch (e) { console.error('خطأ صوت:', e.message); }
                }

                // 3. الإرسال للـ Webhook
                const webhookUrl = process.env.WEBHOOK_URL || process.env.N8N_WEBHOOK_URL;
                if (webhookUrl) {
                    await axios.post(webhookUrl, {
                        type: msgType,               // السيرفر هنا يحدد لك النوع مباشر (text / image / audio)
                        sender: senderJid,
                        phone: senderJid.split('@')[0],
                        message: text,               // النص (أو الـ Caption المكتوب تحت الصورة)
                        media: mediaBase64,          // بيانات الميديا الخام
                        mimeType: mimeType,          // نوع الـ Mime
                        timestamp: msg.messageTimestamp
                    });
                    console.log(`🚀 تم الإرسال للـ Webhook | النوع: ${msgType}`);
                }
            } catch (err) { console.error('❌ خطأ:', err.message); }
        }
    });
}

connectToWhatsApp();
