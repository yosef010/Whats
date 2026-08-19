import os
import sys
import logging
import requests
from neonize.client import NewClient
from neonize.events import MessageEv, ConnectedEv

# إظهار كل سجلات التشغيل
logging.basicConfig(level=logging.INFO)

WEBHOOK_URL = os.getenv("WEBHOOK_URL")

# إنشاء الجلسة داخل الفولدر المربوط بالـ Volume
client = NewClient("whatsapp_session.sqlite3")

@client.event(ConnectedEv)
def on_connected(client: NewClient, __: ConnectedEv):
    print("\n=========================================")
    print("SUCCESS: تم الاتصال بالحساب بنجاح!")
    print("=========================================\n")

@client.event(MessageEv)
def on_message(client: NewClient, message: MessageEv):
    try:
        # قراءة وتمرير الرسائل القادمة من الأشخاص فقط (بدون الجروبات)
        if not message.Info.IsFromMe and not message.Info.IsGroup:
            sender = message.Info.Sender.User
            text = message.Message.conversation or message.Message.extendedTextMessage.text or ""
            
            print(f"📥 رسالة جديدة من [{sender}]: {text}")

            if WEBHOOK_URL:
                payload = {
                    "sender": sender,
                    "message": text,
                    "timestamp": message.Info.Timestamp
                }
                res = requests.post(WEBHOOK_URL, json=payload, timeout=10)
                print(f"🚀 تم التمرير للـ Workflow! حالة الاستجابة: {res.status_code}")
            else:
                print("⚠️ تنبيه: لم يتم تحديد متغير البيئة WEBHOOK_URL!")
    except Exception as e:
        print(f"❌ حدث خطأ أثناء معالجة الرسالة: {e}")

if __name__ == "__main__":
    print("جاري تشغيل محاكي الواتساب...")
    try:
        client.connect()
    except Exception as err:
        print(f"خطأ في الاتصال: {err}")
