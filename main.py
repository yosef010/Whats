import os
import requests
from neonize.client import NewClient
from neonize.events import MessageEv, ConnectedEv

# قراءة رابط الـ Webhook من متغيرات البيئة في Railway
WEBHOOK_URL = os.getenv("WEBHOOK_URL")

client = NewClient("whatsapp_session.sqlite3")

@client.event(ConnectedEv)
def on_connected(client: NewClient, __: ConnectedEv):
    print("تم الاتصال بالواتساب بنجاح!")

@client.event(MessageEv)
def on_message(client: NewClient, message: MessageEv):
    # تجاهل الرسائل الصادرة منك وتجاهل الجروبات
    if not message.Info.IsFromMe and not message.Info.IsGroup:
        sender = message.Info.Sender.User  # رقم الراسل
        text = message.Message.conversation or message.Message.extendedTextMessage.text or ""
        
        print(f"رسالة جديدة من {sender}: {text}")

        # إرسال البيانات للـ Workflow
        if WEBHOOK_URL:
            payload = {
                "sender": sender,
                "message": text,
                "timestamp": message.Info.Timestamp
            }
            try:
                response = requests.post(WEBHOOK_URL, json=payload, timeout=10)
                print(f"تم تحويل الرسالة للـ Workflow! الحالة: {response.status_code}")
            except Exception as e:
                print(f"خطأ أثناء الإرسال للـ Webhook: {e}")

client.connect()
