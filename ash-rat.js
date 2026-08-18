const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { MongoClient } = require('mongodb');

// ==========================================
// 1. AAPKE VARIABLES (YAHAN APNA DATA DAALEIN)
// ==========================================
const TOKEN = process.env.BOT_TOKEN || '8756543651:AAENlmZhViGgky4Cw8zc49nodWetkXFubkE'; 
const ADMIN_CHAT_ID = parseInt(process.env.ADMIN_CHAT_ID || '5291409360); // Number format me likhein

const MONGO_URL = process.env.MONGO_URL || process.env.MONGODB_URI; // Railway ka automatic variable
const PORT = process.env.PORT || 3000;

// Express setup for Railway 24/7 Hosting
const app = express();
app.get('/', (req, res) => res.send('VIP Gateway Bot is Running successfully!'));
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));

// Bot setup
const bot = new TelegramBot(TOKEN, { polling: true });

// ==========================================
// 2. MONGODB SETUP
// ==========================================
let db;
let settingsCollection;
let usersCollection;

async function initDB() {
    try {
        const client = new MongoClient(MONGO_URL);
        await client.connect();
        db = client.db('bot_database');
        
        // Aapke requirements ke hisab se collections ka naam 'ashspreader'
        settingsCollection = db.collection('ashspreader_settings');
        usersCollection = db.collection('ashspreader_users');
        console.log('✅ MongoDB Database Connected Successfully!');
    } catch (err) {
        console.error('❌ MongoDB Connection Error:', err);
    }
}
initDB();

// ==========================================
// 3. ADMIN STATE & HELPER FUNCTIONS
// ==========================================
let adminState = null; // Admin kya bhej raha hai usko track karne ke liye

// Settings Get/Set functions
async function getSettings() {
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
    await settingsCollection.updateOne({ id: 1 }, { $set: updates }, { upsert: true });
}

// ==========================================
// 4. COMMANDS & BOT LOGIC
// ==========================================

// Jab koi /start bheje
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    adminState = null; // Reset admin state

    // User ko DB me save karo agar naya hai
    const userExists = await usersCollection.findOne({ chatId });
    if (!userExists) {
        await usersCollection.insertOne({ chatId, username: msg.from.username, joinedAt: new Date() });
    }

    // AGAR ADMIN HAI -> Admin Dashboard Dikhao
    if (chatId === ADMIN_CHAT_ID) {
        return sendAdminMenu(chatId);
    }

    // AGAR NORMAL USER HAI -> Welcome Video with Buttons
    const settings = await getSettings();
    const inlineKeyboard = [];
    
    // Demo aur Get Apk Buttons
    if (settings.demoLink) inlineKeyboard.push([{ text: '📺 Demo Videos', url: settings.demoLink }]);
    inlineKeyboard.push([{ text: '📥 Get Apk', callback_data: 'get_apk' }]);

    const replyMarkup = { inline_keyboard: inlineKeyboard };
    const options = { reply_markup: replyMarkup };

    // Format aur caption attach karna
    if (settings.welcomeMessage) options.caption = settings.welcomeMessage;
    // Entities stringify karke pass karna zaroori hai tabhi bold/quotes dikhenge
    if (settings.welcomeEntities) options.caption_entities = JSON.stringify(settings.welcomeEntities);

    // Agar Admin ne video set ki hai
    if (settings.welcomeVideoFileId) {
        bot.sendVideo(chatId, settings.welcomeVideoFileId, options).catch(err => console.log(err));
    } else {
        // Agar video set nahi hai, toh simple message bhej do
        const textOptions = { reply_markup: replyMarkup };
        if (settings.welcomeEntities) textOptions.entities = JSON.stringify(settings.welcomeEntities);
        bot.sendMessage(chatId, settings.welcomeMessage, textOptions).catch(err => console.log(err));
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
    bot.sendMessage(chatId, '🛠 *Welcome Admin!* \nYahan se aap apna bot control kar sakte hain:\n\n_(Pichla data auto delete/replace ho jayega)_', { parse_mode: 'Markdown', reply_markup: keyboard });
}

// ==========================================
// 5. BUTTONS CLICKS (INLINE QUERIES)
// ==========================================
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const settings = await getSettings();

    // User ne "Get Apk" pe click kiya
    if (data === 'get_apk') {
        if (settings.apkFileId) {
            let options = { caption: settings.apkCaption || '' };
            if (settings.apkCaptionEntities) options.caption_entities = JSON.stringify(settings.apkCaptionEntities);
            bot.sendDocument(chatId, settings.apkFileId, options).catch(console.error);
        } else {
            bot.sendMessage(chatId, '⚠️ Currently no APK is available. Please contact admin.');
        }
        return bot.answerCallbackQuery(query.id);
    }

    // --------------- ADMIN BUTTONS ---------------
    if (chatId !== ADMIN_CHAT_ID) return bot.answerCallbackQuery(query.id, { text: 'You are not Admin!', show_alert: true });

    switch(data) {
        case 'admin_change_apk':
            adminState = 'WAITING_APK';
            bot.sendMessage(chatId, '📤 *Send me the new APK file now.*\n_(Document file hona chahiye)_', { parse_mode: 'Markdown' });
            break;
        case 'admin_change_welcome_msg':
            adminState = 'WAITING_WELCOME_MSG';
            bot.sendMessage(chatId, '📝 *Send me the new Welcome Message.*\n\n💡 *Note:* Aap is message ko Bold, Italic, Quotes wgera karke bhejein, main waisa hi save karunga.', { parse_mode: 'Markdown' });
            break;
        case 'admin_change_welcome_video':
            adminState = 'WAITING_VIDEO';
            bot.sendMessage(chatId, '🎥 *Send me the new Welcome Video now.*', { parse_mode: 'Markdown' });
            break;
        case 'admin_change_apk_caption':
            adminState = 'WAITING_APK_CAPTION';
            bot.sendMessage(chatId, '✍️ *Send me the new Apk Caption.*\n\n💡 Aap fonts aur format use kar sakte hain.', { parse_mode: 'Markdown' });
            break;
        case 'admin_change_demo_link':
            adminState = 'WAITING_DEMO_LINK';
            bot.sendMessage(chatId, '🔗 *Send me the new Demo Channel Link.*\n_(Example: https://t.me/yourchannel)_', { parse_mode: 'Markdown' });
            break;
        case 'admin_check_users':
            const count = await usersCollection.countDocuments();
            bot.sendMessage(chatId, `👥 *Total Users Start Bot:* ${count}`, { parse_mode: 'Markdown' });
            break;
    }
    bot.answerCallbackQuery(query.id);
});

// ==========================================
// 6. ADMIN MESSAGES / MEDIA HANDLER
// ==========================================
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    
    // Sirf Admin commands suno aur agar state selected hai tabhi execute karo
    if (chatId !== ADMIN_CHAT_ID || !adminState) return;
    if (msg.text && msg.text.startsWith('/')) return; // Ignore /start

    try {
        // Change APK State
        if (adminState === 'WAITING_APK' && msg.document) {
            await updateSettings({ apkFileId: msg.document.file_id });
            bot.sendMessage(chatId, '✅ *APK Updated Successfully!*\nPurani apk auto-replace ho gayi hai.', { parse_mode: 'Markdown' });
            adminState = null;
        } 
        
        // Change Welcome Video State
        else if (adminState === 'WAITING_VIDEO' && msg.video) {
            await updateSettings({ welcomeVideoFileId: msg.video.file_id });
            bot.sendMessage(chatId, '✅ *Welcome Video Updated Successfully!*', { parse_mode: 'Markdown' });
            adminState = null;
        }
        
        // Change Welcome Message State
        else if (adminState === 'WAITING_WELCOME_MSG' && (msg.text || msg.caption)) {
            const text = msg.text || msg.caption;
            // Entities se exact formatting capture hogi (Bold, Mono, Quotes)
            const entities = msg.entities || msg.caption_entities || null; 
            
            await updateSettings({ welcomeMessage: text, welcomeEntities: entities });
            bot.sendMessage(chatId, '✅ *Welcome Message Updated Successfully!*\n_Aapki formatting save kar li gayi hai._', { parse_mode: 'Markdown' });
            adminState = null;
        }
        
        // Change APK Caption State
        else if (adminState === 'WAITING_APK_CAPTION' && (msg.text || msg.caption)) {
            const text = msg.text || msg.caption;
            const entities = msg.entities || msg.caption_entities || null;
            
            await updateSettings({ apkCaption: text, apkCaptionEntities: entities });
            bot.sendMessage(chatId, '✅ *APK Caption Updated Successfully!*', { parse_mode: 'Markdown' });
            adminState = null;
        }
        
        // Change Demo Link State
        else if (adminState === 'WAITING_DEMO_LINK' && msg.text) {
            await updateSettings({ demoLink: msg.text });
            bot.sendMessage(chatId, '✅ *Demo Link Updated Successfully!*', { parse_mode: 'Markdown' });
            adminState = null;
        }
        
        // Error handling if format matched nahi hota
        else {
            bot.sendMessage(chatId, '❌ Wrong format. Please send the correct file/text or send /start to cancel.');
        }

    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, '❌ Error updating data. Please try again.');
    }
});
