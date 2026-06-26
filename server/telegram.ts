import { addUser, getAllUsers } from './db';
import { setDefaultResultOrder } from 'dns';

// Fix for Node 18+ preferring IPv6 which can cause EFATAL: fetch failed on IPv4 only hosts
setDefaultResultOrder('ipv4first');

const token = process.env.TELEGRAM_BOT_TOKEN || '8814109715:AAF8cd7VTxbrZwz5j7GQCUz437jlFLtV-28';

let isPolling = false;
let lastUpdateId = 0;

export const PERSONAL_CHAT_ID = process.env.USER_PERSONAL_CHAT_ID || '8184244632';

export async function startTelegramBot() {
  if (isPolling) return;
  isPolling = true;
  console.log('Telegram bot is started and polling.');

  while (isPolling) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s timeout, slightly longer than poll timeout
      
      const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
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
            
            await addUser(chatId);
            
            if (text.startsWith('/start')) {
              await sendTelegramMessage(chatId, 'Welcome! You are now subscribed to Technical Analysis Crypto Signals.');
            } else if (text.startsWith('/ping')) {
              await sendTelegramMessage(chatId, 'Pong! The bot is active.');
            }
          }
        }
      }
    } catch (e: any) {
      // Specifically ignore common network failures for polling
      const isFetchError = e.message && (e.message.includes('fetch failed') || e.message === 'fetch failed');
      const isAbortError = e.name === 'AbortError' || e.code === 'UND_ERR_CONNECT_TIMEOUT' || e.name === 'TimeoutError';
      const is409Error = e.message && e.message.includes('409');

      if (!isFetchError && !isAbortError && !is409Error) {
        console.error('Telegram polling error:', e.message);
      }
      
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

export function escapeHTML(text: string): string {
  return text.replace(/&/g, '&amp;')
             .replace(/</g, '&lt;')
             .replace(/>/g, '&gt;')
             .replace(/"/g, '&quot;');
}

export async function sendTelegramMessage(chatId: string, text: string, retries = 3) {
  if (chatId.includes(':')) {
    console.warn(`⚠️ Skipped sending message to invalid chat ID (looks like a bot token): ${chatId}`);
    return;
  }
  
  const escapedText = escapeHTML(text);
  
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
      
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: escapedText, parse_mode: 'HTML' }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (res.ok) return;

      const err = await res.text();
      console.error(`Failed to send message to ${chatId} (attempt ${i + 1}):`, err);
    } catch(e: any) {
      console.error(`Failed to send message to ${chatId} (attempt ${i + 1}):`, e.message);
    }
    await new Promise(r => setTimeout(r, 1000 * (i + 1))); // Backoff
  }
}

export async function broadcastMessage(message: string) {
  const users = await getAllUsers();
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  
  if (users.length === 0 && !channelId) {
    console.warn('⚠️ No users subscribed (nobody sent /start) and TELEGRAM_CHANNEL_ID is not set. Skipping broadcast.');
    return;
  }

  const broadcastPromises = [];

  if (channelId) {
    broadcastPromises.push(sendTelegramMessage(channelId, message));
  }

  users.forEach((userId) => {
    broadcastPromises.push(sendTelegramMessage(userId, message));
  });

  try {
    await Promise.all(broadcastPromises);
    console.log(`Successfully broadcasted message to ${broadcastPromises.length} recipients.`);
  } catch (error) {
    console.error('Error broadcasting message:', error);
  }
}

// Start polling in the background without blocking
startTelegramBot().catch(e => console.error('Telegram bot loop crashed:', e));
