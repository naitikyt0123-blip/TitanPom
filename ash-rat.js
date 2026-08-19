const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { MongoClient } = require('mongodb');

// ==========================================
// 1. CREDENTIALS
// ==========================================
const TOKEN = '8816839787:AAF4WyIYIMgyhJhw7gXV8CT_1dlJFLE_B5w';
const ADMIN_CHAT_ID = 5059892417;

const MONGO_URL = process.env.MONGO_URL || process.env.MONGODB_URI; 
const PORT = process.env.PORT || 3000;

// Express setup for Railway (Port Binding)
const app = express();
app.get('/', (req, res) => res.send('VIP Gateway Bot is Running successfully!'));
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));

// Bot setup
const bot = new TelegramBot(TOKEN, { polling: true });

bot.on('polling_error', (error) => {
    console.error('Polling Error:', error.message);
});

// ==========================================
// 2. MONGODB SETUP
// ==========================================
let db;
let settingsCollection;
let usersCollection;

async function initDB() {
    try {
        if (!MONGO_URL) {
            console.error('❌ MongoDB URL is missing!');
            return;
        }
        const client = new MongoClient(MONGO_URL);
        await client.connect();
        db = client.db('bot_database');
        
        settingsCollection = db.collection('ashspreader_settings');
        usersCollection = db.collection('ashspreader_users');
        console.log('✅ MongoDB Connected!');
    } catch (err) {
        console.error('❌ MongoDB Error:', err.message);
    }
}
initDB();

// ==========================================
// 3. SETTINGS FUNCTIONS
// ==========================================
let adminState = null;

async function getSettings() {
    if (!settingsCollection) return {};
    let settings = await settingsCollection.findOne({ id: 1 });
    if (!settings) {
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

// Helper function to send APK
async function sendApkToUser(chatId) {
    const settings = await getSettings();
    if (settings.apkFileId) {
        let options = { caption: settings.apkCaption || '' };
        if (settings.apkCaptionEntities) options.caption_entities = JSON.stringify(settings.apkCaptionEntities);
        
        bot.sendDocument(chatId, settings.apkFileId, options).catch(err => console.error(err.message));
    } else {
        bot.sendMessage(chatId, '⚠️ Currently no APK is available. Please contact admin.').catch(err => console.error(err.message));
    }
}

// ==========================================
// 4. COMMANDS & BOT LOGIC (/start)
// ==========================================
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    adminState = null;

    if (usersCollection) {
        const userExists = await usersCollection.findOne({ chatId });
        if (!userExists) {
            await usersCollection.insertOne({ chatId, username: msg.from.username, joinedAt: new Date() });
        }
    }

    if (chatId === ADMIN_CHAT_ID) {
        return sendAdminMenu(chatId);
    }

    const settings = await getSettings();
    
    // Inline Keyboard setup with Style properties
    const inlineKeyboard = [];
    
    // Custom v9.4 Style attribute button ("Green Success")
    inlineKeyboard.push([
        { 
            text: '🟢 Download Play Store Apk', 
            callback_data: 'get_apk',
            style: 'success' // Using the new API feature for green success color
        }
    ]);

    // Demo Videos Link
    if (settings.demoLink) inlineKeyboard.push([{ text: '📺 Demo Videos', url: settings.demoLink }]);
    
    // Bold font buttons for Help and Use
    inlineKeyboard.push([
        { text: '𝗡𝗲𝗲𝗱 𝗛𝗲𝗹𝗽?', callback_data: 'get_apk' }, 
        { text: '𝗛𝗼𝘄 𝗧𝗼 𝗨𝘀𝗲?', callback_data: 'get_apk' }
    ]);

    const options = { reply_markup: { inline_keyboard: inlineKeyboard } };

    if (settings.welcomeVideoFileId) {
        options.caption = settings.welcomeMessage || '';
        if (settings.welcomeEntities) options.caption_entities = JSON.stringify(settings.welcomeEntities);
        bot.sendVideo(chatId, settings.welcomeVideoFileId, options).catch(err => console.error(err.message));
    } else {
        if (settings.welcomeEntities) options.entities = JSON.stringify(settings.welcomeEntities);
        bot.sendMessage(chatId, settings.welcomeMessage || 'Welcome!', options).catch(err => console.error(err.message));
    }
});

// Admin Dashboard
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
    bot.sendMessage(chatId, '🛠 *Admin Menu*\n\nNaya data automatically purane ko delete karke save ho jayega.', { parse_mode: 'Markdown', reply_markup: keyboard }).catch(err => console.error(err.message));
}

// ==========================================
// 5. BUTTON CLICKS (INLINE QUERIES)
// ==========================================
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    // "Download Play Store Apk", "Need Help?", and "How To Use?" will trigger this
    if (data === 'get_apk') {
        await sendApkToUser(chatId);
        return bot.answerCallbackQuery(query.id);
    }

    // Admin validations
    if (chatId !== ADMIN_CHAT_ID) return bot.answerCallbackQuery(query.id, { text: 'Not Admin!', show_alert: true });

    switch(data) {
        case 'admin_change_apk':
            adminState = 'WAITING_APK';
            bot.sendMessage(chatId, '📤 *Send me the new APK file now.*', { parse_mode: 'Markdown' });
            break;
        case 'admin_change_welcome_msg':
            adminState = 'WAITING_WELCOME_MSG';
            bot.sendMessage(chatId, '📝 *Send me the new Welcome Message.*', { parse_mode: 'Markdown' });
            break;
        case 'admin_change_welcome_video':
            adminState = 'WAITING_VIDEO';
            bot.sendMessage(chatId, '🎥 *Send me the new Welcome Video now.*', { parse_mode: 'Markdown' });
            break;
        case 'admin_change_apk_caption':
            adminState = 'WAITING_APK_CAPTION';
            bot.sendMessage(chatId, '✍️ *Send me the new Apk Caption.*', { parse_mode: 'Markdown' });
            break;
        case 'admin_change_demo_link':
            adminState = 'WAITING_DEMO_LINK';
            bot.sendMessage(chatId, '🔗 *Send me the new channel link.*\n_(Jo link aap denge, Demo Videos button par click karne se user directly wahi redirect hoga)_', { parse_mode: 'Markdown' });
            break;
        case 'admin_check_users':
            if (usersCollection) {
                const count = await usersCollection.countDocuments();
                bot.sendMessage(chatId, `👥 *Total Users:* ${count}`, { parse_mode: 'Markdown' });
            }
            break;
    }
    bot.answerCallbackQuery(query.id).catch(err => console.error(err.message));
});

// ==========================================
// 6. GENERAL MESSAGE HANDLER (TEXT & MEDIA)
// ==========================================
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    
    if (chatId !== ADMIN_CHAT_ID || !adminState) return;
    if (msg.text && msg.text.startsWith('/')) return; 

    try {
        if (adminState === 'WAITING_APK' && msg.document) {
            await updateSettings({ apkFileId: msg.document.file_id });
            bot.sendMessage(chatId, '✅ *APK Updated Successfully!*', { parse_mode: 'Markdown' });
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
            bot.sendMessage(chatId, '✅ *Welcome Message Updated!*', { parse_mode: 'Markdown' });
            adminState = null;
        }
        else if (adminState === 'WAITING_APK_CAPTION' && (msg.text || msg.caption)) {
            const text = msg.text || msg.caption;
            const entities = msg.entities || msg.caption_entities || null;
            
            await updateSettings({ apkCaption: text, apkCaptionEntities: entities });
            bot.sendMessage(chatId, '✅ *APK Caption Updated!*', { parse_mode: 'Markdown' });
            adminState = null;
        }
        else if (adminState === 'WAITING_DEMO_LINK' && msg.text) {
            await updateSettings({ demoLink: msg.text });
            bot.sendMessage(chatId, '✅ *Demo Link Updated! Demo Videos button ab is link par open hoga.*', { parse_mode: 'Markdown' });
            adminState = null;
        }
        else {
            bot.sendMessage(chatId, '❌ Wrong format. Please try again or send /start to cancel.');
        }
    } catch (err) {
        console.error(err.message);
        bot.sendMessage(chatId, '❌ Error updating data. Please try again.');
    }
});
