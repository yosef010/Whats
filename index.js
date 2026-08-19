global.crypto = require('crypto'); // أضف هذا السطر في البداية تماماً

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const axios = require('axios');
const qrcode = require('qrcode-terminal');

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ["Railway Bot", "Chrome", "1.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log("\n=========================================");
            console.log("امسح الـ QR Code التالي للربط:");
            qrcode.generate(qr, { small: true });
            console.log("=========================================\n");
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('انقطع الاتصال، جاري إعادة المحاولة...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
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
