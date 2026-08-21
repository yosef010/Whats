// ... (الـ Imports في بداية الملف تظل كما هي)
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadContentFromMessage } = require('@whiskeysockets/baileys');
// ... (باقي الـ Imports)

// داخل الـ messages.upsert:
sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
        if (msg.key.fromMe || !msg.message) continue;

        const senderJid = msg.key.remoteJid;
        if (senderJid.endsWith('@g.us')) continue;

        // 1. استخراج النص (شامل الـ caption للصور والفيديو)
        const msgContent = msg.message;
        const text = msgContent.conversation || 
                     msgContent.extendedTextMessage?.text || 
                     msgContent.imageMessage?.caption || 
                     msgContent.videoMessage?.caption || '';

        // 2. اكتشاف الوسائط (صورة أو صوت)
        const imageMsg = msgContent.imageMessage;
        const audioMsg = msgContent.audioMessage || msgContent.pttMessage;
        
        let mediaBase64 = null;
        let mimeType = null;

        if (imageMsg || audioMsg) {
            try {
                const stream = await downloadContentFromMessage(imageMsg || audioMsg, imageMsg ? 'image' : 'audio');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                mediaBase64 = `data:${imageMsg ? 'image/jpeg' : 'audio/ogg'};base64,${buffer.toString('base64')}`;
                mimeType = imageMsg ? 'image/jpeg' : 'audio/ogg';
            } catch (err) { console.error('خطأ تحميل الوسائط:', err); }
        }

        // 3. الإرسال للـ Webhook
        const webhookUrl = process.env.WEBHOOK_URL || process.env.N8N_WEBHOOK_URL;
        if (webhookUrl) {
            try {
                await axios.post(webhookUrl, {
                    sender: senderJid,
                    phone: senderJid.split('@')[0],
                    message: text, // الآن النص سيحتوي على الـ caption أيضاً
                    media: mediaBase64 ? { data: mediaBase64, mimeType: mimeType } : null,
                    timestamp: msg.messageTimestamp
                });
            } catch (err) { console.error('خطأ في Webhook:', err.message); }
        }
    }
});
