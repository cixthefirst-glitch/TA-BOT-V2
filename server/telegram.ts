import { addUser, getAllUsers } from './db';
import { setDefaultResultOrder } from 'dns';

// Fix for Node 18+ preferring IPv6 which can cause EFATAL: fetch failed on IPv4 only hosts
setDefaultResultOrder('ipv4first');

const token = process.env.TELEGRAM_BOT_TOKEN || '8814109715:AAF8cd7VTxbrZwz5j7GQCUz437jlFLtV-28';

let isPolling = false;
let lastUpdateId = 0;

export async function startTelegramBot() {
  if (isPolling) return;
  isPolling = true;
  console.log('Telegram bot is started and polling.');

  while (isPolling) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`);
      
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      
      const data = await res.json();
      
      if (data.ok) {
        for (const update of data.result) {
          lastUpdateId = update.update_id;
          
          if (update.message && update.message.text) {
            const text = update.message.text;
            const chatId = update.message.chat.id.toString();
            
            if (text.startsWith('/start')) {
              await addUser(chatId);
              await sendTelegramMessage(chatId, 'Welcome! You are now subscribed to Technical Analysis Crypto Signals.');
            }
            if (text.startsWith('/ping')) {
              await sendTelegramMessage(chatId, 'Pong! The bot is active.');
            }
          }
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError' && e.code !== 'UND_ERR_CONNECT_TIMEOUT') {
        if (e.message && e.message.includes('409')) {
          // 409 Conflict: another instance is polling, common during dev reloads.
          // Fallback to silent retry.
        } else {
          console.error('Telegram polling error:', e.message);
        }
      }
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

export async function sendTelegramMessage(chatId: string, text: string) {
  if (chatId.includes(':')) {
    console.warn(`⚠️ Skipped sending message to invalid chat ID (looks like a bot token): ${chatId}`);
    return;
  }
  
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("Failed to send message to " + chatId + ":", err);
    }
  } catch(e: any) {
    console.error("Failed to send message to " + chatId + ":", e.message);
  }
}

export async function broadcastMessage(message: string) {
  const users = await getAllUsers();
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  
  if (users.length === 0 && !channelId) {
    console.warn('⚠️ No users subscribed (nobody sent /start) and TELEGRAM_CHANNEL_ID is not set. Skipping broadcast.');
    return;
  }

  if (channelId) {
    sendTelegramMessage(channelId, message);
  }

  users.forEach((userId) => {
    sendTelegramMessage(userId, message);
  });
}

// Start polling in the background without blocking
startTelegramBot().catch(e => console.error('Telegram bot loop crashed:', e));
