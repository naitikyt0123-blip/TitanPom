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
// 3. SETTINGS & HELPER FUNCTIONS
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

// Function to send APK file to the user
async function sendApkToUser(chatId, withReplyKeyboard = false) {
    const settings = await getSettings();
    
    if (settings.apkFileId) {
        let options = { caption: settings.apkCaption || '' };
        if (settings.apkCaptionEntities) options.caption_entities = JSON.stringify(settings.apkCaptionEntities);
        
        // Add Reply Keyboard to the APK message if required
        if (withReplyKeyboard) {
            options.reply_markup = {
                keyboard: [[{ text: 'Download Play Store Apk', style: 'success' }]],
                resize_keyboard: true,
                is_persistent: true
            };
        }

        await bot.sendDocument(chatId, settings.apkFileId, options).catch(err => console.error(err.message));
    } else {
        await bot.sendMessage(chatId, '⚠️ Currently no APK is available. Please contact admin.').catch(err => console.error(err.message));
    }
}

// ==========================================
// 4. COMMANDS & BOT LOGIC (/start)
// ==========================================
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    adminState = null;

    // Register User
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
    
    // --- STEP 1: SEND WELCOME MESSAGE/VIDEO ---
    const welcomeInlineKeyboard = [];
    if (settings.demoLink) welcomeInlineKeyboard.push([{ text: '📺 Demo Videos', url: settings.demoLink }]);
    
    welcomeInlineKeyboard.push([{ 
        text: 'Download Play Store Apk', 
        callback_data: 'get_apk', 
        style: 'success' 
    }]);

    const welcomeOptions = { reply_markup: { inline_keyboard: welcomeInlineKeyboard } };

    if (settings.welcomeVideoFileId) {
        welcomeOptions.caption = settings.welcomeMessage || '';
        if (settings.welcomeEntities) welcomeOptions.caption_entities = JSON.stringify(settings.welcomeEntities);
        await bot.sendVideo(chatId, settings.welcomeVideoFileId, welcomeOptions).catch(err => console.error(err.message));
    } else {
        if (settings.welcomeEntities) welcomeOptions.entities = JSON.stringify(settings.welcomeEntities);
        await bot.sendMessage(chatId, settings.welcomeMessage || 'Welcome!', welcomeOptions).catch(err => console.error(err.message));
    }

    // --- STEP 2: SEND APK FILE IMMEDIATELY ---
    // Passing true to attach the bottom Reply Keyboard with this APK message
    await sendApkToUser(chatId, true); 

    // --- STEP 3: SEND "Need Help?" MESSAGE ---
    const helpOptions = {
        reply_markup: {
            inline_keyboard: [[{ text: 'How To Use?', callback_data: 'get_apk' }]]
        }
    };
    await bot.sendMessage(chatId, '*Need Help?*', { parse_mode: 'Markdown', ...helpOptions }).catch(err => console.error(err.message));
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
            [{ text: '📢 Broadcast', callback_data: 'admin_broadcast' }],
            [{ text: '👥 Check Total Users', callback_data: 'admin_check_users' }]
        ]
    };
    bot.sendMessage(chatId, '🛠 *Admin Menu*\n\nYahan se aap bot ko control kar sakte hain.', { parse_mode: 'Markdown', reply_markup: keyboard }).catch(err => console.error(err.message));
}

// ==========================================
// 5. BUTTON CLICKS (INLINE QUERIES)
// ==========================================
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    // "Download Play Store Apk" and "How To Use?" will trigger this
    if (data === 'get_apk') {
        await sendApkToUser(chatId, false); // Don't attach reply keyboard again, just send file
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
            bot.sendMessage(chatId, '🔗 *Send me the new channel link.*', { parse_mode: 'Markdown' });
            break;
        case 'admin_broadcast':
            adminState = 'WAITING_BROADCAST';
            bot.sendMessage(chatId, '📢 *Send the message you want to broadcast.*\n_(You can send Text, Image, Video, or File. It will be sent exactly as you format it)_', { parse_mode: 'Markdown' });
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
// 6. GENERAL MESSAGE HANDLER
// ==========================================
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    
    // Normal user clicking the bottom Reply Keyboard button
    if (msg.text === 'Download Play Store Apk') {
        return await sendApkToUser(chatId, false);
    }

    if (chatId !== ADMIN_CHAT_ID || !adminState) return;
    if (msg.text && msg.text.startsWith('/')) return; 

    try {
        // --- BROADCAST LOGIC ---
        if (adminState === 'WAITING_BROADCAST') {
            bot.sendMessage(chatId, '⏳ *Broadcast started! Please wait...*', { parse_mode: 'Markdown' });
            adminState = null; // Reset state immediately

            const users = await usersCollection.find({}).toArray();
            let success = 0;
            let failed = 0;

            for (let user of users) {
                try {
                    // Copy message sends exact format, media, fonts directly
                    await bot.copyMessage(user.chatId, chatId, msg.message_id);
                    success++;
                } catch (error) {
                    failed++;
                }
            }
            return bot.sendMessage(chatId, `✅ *Broadcast Finished!*\n\n🚀 Sent to: ${success}\n❌ Failed (Blocked bot): ${failed}`, { parse_mode: 'Markdown' });
        }

        // --- OTHER ADMIN UPDATES ---
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
            bot.sendMessage(chatId, '✅ *Demo Link Updated!*', { parse_mode: 'Markdown' });
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
