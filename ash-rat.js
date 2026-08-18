const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { MongoClient } = require('mongodb');

// ==========================================
// 1. CREDENTIALS (FIXED)
// ==========================================
const TOKEN = '8816839787:AAF4WyIYIMgyhJhw7gXV8CT_1dlJFLE_B5w';
const ADMIN_CHAT_ID = 5059892417;

// Railway automatically provides MONGO_URL or MONGODB_URI
const MONGO_URL = process.env.MONGO_URL || process.env.MONGODB_URI; 
const PORT = process.env.PORT || 3000;

// Express setup for Railway 24/7 Hosting (Prevents Port Binding Crash)
const app = express();
app.get('/', (req, res) => res.send('VIP Gateway Bot is Running successfully!'));
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));

// Bot setup
const bot = new TelegramBot(TOKEN, { polling: true });

// Error handling for Bot Polling to prevent crashes
bot.on('polling_error', (error) => {
    console.error('Polling Error:', error.message);
});

// ==========================================
// 2. MONGODB SETUP (ashspreader collection)
// ==========================================
let db;
let settingsCollection;
let usersCollection;

async function initDB() {
    try {
        if (!MONGO_URL) {
            console.error('❌ MongoDB URL is missing in Railway Variables!');
            return;
        }
        const client = new MongoClient(MONGO_URL);
        await client.connect();
        db = client.db('bot_database');
        
        settingsCollection = db.collection('ashspreader_settings');
        usersCollection = db.collection('ashspreader_users');
        console.log('✅ MongoDB Database Connected Successfully!');
    } catch (err) {
        console.error('❌ MongoDB Connection Error:', err.message);
    }
}
initDB();

// ==========================================
// 3. ADMIN STATE & HELPER FUNCTIONS
// ==========================================
let adminState = null;

async function getSettings() {
    if (!settingsCollection) return {};
    let settings = await settingsCollection.findOne({ id: 1 });
    if (!settings) {
        // Default Settings
        settings = { 
            id: 1, 
            welcomeVideoFileId: null, 
            welcomeMessage: "Welcome to our VIP Bot!", 
            welcomeEntities: null, 
            apkFileId: null, 
            apkCaption: "Here is your app 👇", 
            apkCaptionEntities: null, 
            demoLink: "https://t.me/telegram" 
        };
        await settingsCollection.insertOne(settings);
    }
    return settings;
}

async function updateSettings(updates) {
    if (settingsCollection) {
        await settingsCollection.updateOne({ id: 1 }, { $set: updates }, { upsert: true });
    }
}

// ==========================================
// 4. COMMANDS & BOT LOGIC (/start)
// ==========================================
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    adminState = null; // Reset admin state on /start

    // Save user if new
    if (usersCollection) {
        const userExists = await usersCollection.findOne({ chatId });
        if (!userExists) {
            await usersCollection.insertOne({ chatId, username: msg.from.username, joinedAt: new Date() });
        }
    }

    // AGAR ADMIN HAI -> Dashboard
    if (chatId === ADMIN_CHAT_ID) {
        return sendAdminMenu(chatId);
    }

    // AGAR NORMAL USER HAI -> Welcome Message/Video
    const settings = await getSettings();
    const inlineKeyboard = [];
    
    if (settings.demoLink) inlineKeyboard.push([{ text: '📺 Demo Videos', url: settings.demoLink }]);
    inlineKeyboard.push([{ text: '📥 Get Apk', callback_data: 'get_apk' }]);

    const replyMarkup = { inline_keyboard: inlineKeyboard };
    const options = { reply_markup: replyMarkup };

    if (settings.welcomeVideoFileId) {
        // Video with attached caption
        options.caption = settings.welcomeMessage || '';
        if (settings.welcomeEntities) options.caption_entities = JSON.stringify(settings.welcomeEntities);
        
        bot.sendVideo(chatId, settings.welcomeVideoFileId, options).catch(err => console.error("Send Video Error:", err.message));
    } else {
        // Only Text Message
        if (settings.welcomeEntities) options.entities = JSON.stringify(settings.welcomeEntities);
        
        bot.sendMessage(chatId, settings.welcomeMessage || 'Welcome!', options).catch(err => console.error("Send Message Error:", err.message));
    }
});

// Admin Dashboard Menu
function sendAdminMenu(chatId) {
    const keyboard = {
        inline_keyboard: [
            [{ text: '📤 Change Apk', callback_data: 'admin_change_apk' }],
            [{ text: '📝 Change Welcome Message', callback_data: 'admin_change_welcome_msg' }],
            [{ text: '🎥 Change Welcome Video', callback_data: 'admin_change_welcome_video' }],
            [{ text: '✍️ Change Apk Caption', callback_data: 'admin_change_apk_caption' }],
            [{ text: '🔗 Change Demo Channel Link', callback_data: 'admin_change_demo_link' }],
            [{ text: '👥 Check Total Users', callback_data: 'admin_check_users' }]
        ]
    };
    bot.sendMessage(chatId, '🛠 *Welcome Admin!*\nYahan se aap apna bot control kar sakte hain:\n\n_(Naya data automatic purane ko replace kar dega)_', { parse_mode: 'Markdown', reply_markup: keyboard }).catch(err => console.error(err.message));
}

// ==========================================
// 5. BUTTON CLICKS (INLINE QUERIES)
// ==========================================
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const settings = await getSettings();

    // USER: Get Apk Button
    if (data === 'get_apk') {
        if (settings.apkFileId) {
            let options = { caption: settings.apkCaption || '' };
            if (settings.apkCaptionEntities) options.caption_entities = JSON.stringify(settings.apkCaptionEntities);
            
            bot.sendDocument(chatId, settings.apkFileId, options).catch(err => console.error("Send APK Error:", err.message));
        } else {
            bot.sendMessage(chatId, '⚠️ Currently no APK is available. Please contact admin.').catch(err => console.error(err.message));
        }
        return bot.answerCallbackQuery(query.id);
    }

    // ADMIN: Button Clicks
    if (chatId !== ADMIN_CHAT_ID) {
        return bot.answerCallbackQuery(query.id, { text: 'You are not Admin!', show_alert: true });
    }

    switch(data) {
        case 'admin_change_apk':
            adminState = 'WAITING_APK';
            bot.sendMessage(chatId, '📤 *Send me the new APK file now.*\n_(Sirf Document file bhejein)_', { parse_mode: 'Markdown' });
            break;
        case 'admin_change_welcome_msg':
            adminState = 'WAITING_WELCOME_MSG';
            bot.sendMessage(chatId, '📝 *Send me the new Welcome Message.*\n\n💡 _Aap fonts (Bold, Italic, Quotes) lagakar bhejenge, main waisa hi save karunga._', { parse_mode: 'Markdown' });
            break;
        case 'admin_change_welcome_video':
            adminState = 'WAITING_VIDEO';
            bot.sendMessage(chatId, '🎥 *Send me the new Welcome Video now.*', { parse_mode: 'Markdown' });
            break;
        case 'admin_change_apk_caption':
            adminState = 'WAITING_APK_CAPTION';
            bot.sendMessage(chatId, '✍️ *Send me the new Apk Caption.*\n\n💡 _Aap text ko bold/italic karke bhej sakte hain._', { parse_mode: 'Markdown' });
            break;
        case 'admin_change_demo_link':
            adminState = 'WAITING_DEMO_LINK';
            bot.sendMessage(chatId, '🔗 *Send me the new Demo Channel Link.*\n_(Example: https://t.me/yourchannel)_', { parse_mode: 'Markdown' });
            break;
        case 'admin_check_users':
            if (usersCollection) {
                const count = await usersCollection.countDocuments();
                bot.sendMessage(chatId, `👥 *Total Users on Bot:* ${count}`, { parse_mode: 'Markdown' });
            }
            break;
    }
    bot.answerCallbackQuery(query.id).catch(err => console.error(err.message));
});

// ==========================================
// 6. ADMIN MESSAGES / MEDIA HANDLER
// ==========================================
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    
    // Ignore non-admins, undefined states, or commands
    if (chatId !== ADMIN_CHAT_ID || !adminState) return;
    if (msg.text && msg.text.startsWith('/')) return; 

    try {
        if (adminState === 'WAITING_APK' && msg.document) {
            await updateSettings({ apkFileId: msg.document.file_id });
            bot.sendMessage(chatId, '✅ *APK Updated Successfully!*\nPurani apk auto-replace ho gayi hai.', { parse_mode: 'Markdown' });
            adminState = null;
        } 
        else if (adminState === 'WAITING_VIDEO' && msg.video) {
            await updateSettings({ welcomeVideoFileId: msg.video.file_id });
            bot.sendMessage(chatId, '✅ *Welcome Video Updated Successfully!*', { parse_mode: 'Markdown' });
            adminState = null;
        }
        else if (adminState === 'WAITING_WELCOME_MSG' && (msg.text || msg.caption)) {
            const text = msg.text || msg.caption;
            const entities = msg.entities || msg.caption_entities || null; 
            
            await updateSettings({ welcomeMessage: text, welcomeEntities: entities });
            bot.sendMessage(chatId, '✅ *Welcome Message Updated Successfully!*\n_Aapki exact formatting save kar li gayi hai._', { parse_mode: 'Markdown' });
            adminState = null;
        }
        else if (adminState === 'WAITING_APK_CAPTION' && (msg.text || msg.caption)) {
            const text = msg.text || msg.caption;
            const entities = msg.entities || msg.caption_entities || null;
            
            await updateSettings({ apkCaption: text, apkCaptionEntities: entities });
            bot.sendMessage(chatId, '✅ *APK Caption Updated Successfully!*', { parse_mode: 'Markdown' });
            adminState = null;
        }
        else if (adminState === 'WAITING_DEMO_LINK' && msg.text) {
            await updateSettings({ demoLink: msg.text });
            bot.sendMessage(chatId, '✅ *Demo Link Updated Successfully!*', { parse_mode: 'Markdown' });
            adminState = null;
        }
        else {
            bot.sendMessage(chatId, '❌ Wrong format. Please send the correct file/text according to the button you clicked, or send /start to cancel.');
        }
    } catch (err) {
        console.error("Handler Error:", err.message);
        bot.sendMessage(chatId, '❌ Error updating data. Please try again.');
    }
});
