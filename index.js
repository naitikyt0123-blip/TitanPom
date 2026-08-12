const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { MongoClient } = require('mongodb');

const botToken = "8459603547:AAG6v_u2Sr5EB2T9AmQ7bWMTc0-MrtvfH2E";
const adminId = "6198353113";
const mongoUrl = process.env.MONGO_URL; 

let bot;
let collection;

// Default data structure
let data = {
    users: [],
    user_details: {},
    demos: [],
    states: {},
    pending: [],
    history: { approved: 0, rejected: 0 },
    settings: {
        upi: 'example@ybl',
        support: '@nglynx',
        premium_image: 'https://i.ibb.co/9x38myC/x.jpg',
        price_indian: '199',
        price_premium: '299',
        price_movies: '399',
        price_all: '499',
        link_indian: 'https://t.me/link1',
        link_premium: 'https://t.me/link2',
        link_movies: 'https://t.me/link3',
        link_all: 'https://t.me/link4'
    }
};

async function initBot() {
    if (!mongoUrl) {
        console.error("❌ ERROR: MONGO_URL variable is not set!");
        process.exit(1);
    }

    try {
        const dbClient = new MongoClient(mongoUrl);
        await dbClient.connect();
        const db = dbClient.db('titanpom');
        collection = db.collection('botStorage');
        console.log("✅ Connected to MongoDB successfully!");

        const dbData = await collection.findOne({ _id: 'main_data' });

        if (!dbData) {
            console.log("⚠️ MongoDB is empty. Fetching old data from URL...");
            try {
                const response = await axios.get("https://vipcentre.site/titanbotpom/data.json");
                if (response.data) data = { ...data, ...response.data };
                console.log("✅ Remote data fetched successfully.");
            } catch (err) {
                console.log("❌ Failed to fetch remote data. Using default local data.");
            }

            if (!data.users) data.users = [];
            if (!data.user_details) {
                data.user_details = {};
                data.users.forEach(u => { data.user_details[u] = "User (@NoUsername)"; });
            }

            await collection.updateOne({ _id: 'main_data' }, { $set: data }, { upsert: true });
        } else {
            console.log("✅ Old data loaded from MongoDB successfully.");
            data = dbData;
            delete data._id; 

            if (!data.users) data.users = [];
            if (!data.user_details) data.user_details = {};
            if (!data.demos) data.demos = [];
            if (!data.states) data.states = {};
            if (!data.history) data.history = { approved: 0, rejected: 0 };
            if (!data.settings) data.settings = {};
        }

        bot = new TelegramBot(botToken, { polling: true });
        
        bot.on('polling_error', (error) => {
            console.error("⚠️ Polling Warning (Handled):", error.message);
        });

        setupBotListeners();
        console.log("🚀 Bot is now online and polling for messages!");

        const shutdown = async () => {
            console.log("🛑 Shutdown signal received. Stopping bot polling securely...");
            try {
                await bot.stopPolling();
            } catch (e) {
                console.error("Error stopping polling:", e);
            }
            process.exit(0);
        };

        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);

    } catch (error) {
        console.error("❌ Fatal Startup Error:", error);
        process.exit(1); 
    }
}

function saveData() {
    if (collection) {
        collection.updateOne({ _id: 'main_data' }, { $set: data }, { upsert: true })
            .catch(err => console.error("❌ MongoDB Save Error:", err));
    }
}

function getAdminMenu() {
    return {
        keyboard: [
            [{ text: 'Change UPI' }, { text: 'Change Username' }],
            [{ text: 'Change Price' }, { text: 'Add Links' }],
            [{ text: 'Change Premium Image' }, { text: 'Process Link Video' }],
            [{ text: 'Add Demo Video' }, { text: 'Remove Demo' }],
            [{ text: 'Check Users List' }, { text: 'Check History' }]
        ],
        resize_keyboard: true
    };
}

function setupBotListeners() {
    bot.on('message', async (msg) => {
        if (!msg.chat) return;
        if (!data || !Array.isArray(data.users)) return;

        const chatId = msg.chat.id.toString();
        const text = msg.text || '';
        const captionText = msg.caption || '';
        const photo = msg.photo ? msg.photo[msg.photo.length - 1].file_id : null;
        const video = msg.video ? msg.video.file_id : null;
        const firstName = msg.from.first_name || 'User';
        const username = msg.from.username || 'NoUsername';

        if (!data.users.includes(chatId)) {
            data.users.push(chatId);
            
            const safeName = firstName.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            const newUserMention = `<a href='tg://user?id=${chatId}'>${safeName}</a>`;
            const adminMsg = `🚨 <b>New User Started Bot!</b>\n\n👤 <b>Name:</b> ${newUserMention}\n🆔 <b>Chat ID:</b> <code>${chatId}</code>\n🔗 <b>Username:</b> @${username}`;
            
            bot.sendMessage(adminId, adminMsg, { parse_mode: 'HTML' }).catch(e => console.error(e.message));
        }
        
        data.user_details[chatId] = `${firstName} (@${username})`;
        saveData();

        const state = data.states[chatId] || 'none';
        const isAdmin = (chatId === adminId);

        if (isAdmin) {
            // ... (All admin states remain unchanged) ...
            if (text.startsWith('/bdc ') || captionText.startsWith('/bdc ')) {
                const msgId = msg.message_id;
                
                if (data.last_bdc_id === msgId) return;
                data.last_bdc_id = msgId;
                saveData();

                const bdcText = text.startsWith('/bdc ') ? text.substring(5) : captionText.substring(5);
                let successCount = 0;
                const uniqueUsers = [...new Set(data.users)];
                
                for (const uId of uniqueUsers) {
                    try {
                        if (photo) await bot.sendPhoto(uId, photo, { caption: bdcText });
                        else if (video) await bot.sendVideo(uId, video, { caption: bdcText });
                        else await bot.sendMessage(uId, bdcText);
                        successCount++;
                    } catch (e) {
                        // User blocked bot
                    }
                }
                return bot.sendMessage(chatId, `✅ Broadcast successfully sent to ${successCount} unique users.`);
            }

            if (state === 'wait_upi' && text) {
                data.settings.upi = text;
                data.states[chatId] = 'none';
                saveData();
                return bot.sendMessage(chatId, `✅ UPI successfully updated to: ${text}`, { reply_markup: getAdminMenu() });
            }
            
            if (state === 'wait_username' && text) {
                data.settings.support = text;
                data.states[chatId] = 'none';
                saveData();
                return bot.sendMessage(chatId, `✅ Support username updated to: ${text}`, { reply_markup: getAdminMenu() });
            }
            
            const catMapping = { 'Indian': 'indian', 'R@p': 'premium', 'Child': 'movies', 'All': 'all' };
            
            if (state === 'wait_price_category' && text) {
                if (catMapping[text]) {
                    data.states[chatId] = 'wait_price_val_' + catMapping[text];
                    saveData();
                    return bot.sendMessage(chatId, `Send the new price for ${text} category (Numbers only):`, { reply_markup: { remove_keyboard: true } });
                } else {
                    data.states[chatId] = 'none';
                    saveData();
                    return bot.sendMessage(chatId, "❌ Cancelled.", { reply_markup: getAdminMenu() });
                }
            }
            
            if (state.startsWith('wait_price_val_') && !isNaN(text)) {
                const cat = state.replace('wait_price_val_', '');
                data.settings[`price_${cat}`] = text;
                data.states[chatId] = 'none';
                saveData();
                return bot.sendMessage(chatId, `✅ Price updated to ₹${text}!`, { reply_markup: getAdminMenu() });
            }
            
            if (state === 'wait_link_category' && text) {
                if (catMapping[text]) {
                    data.states[chatId] = 'wait_link_val_' + catMapping[text];
                    saveData();
                    return bot.sendMessage(chatId, `Send the new private channel link for ${text}:`, { reply_markup: { remove_keyboard: true } });
                } else {
                    data.states[chatId] = 'none';
                    saveData();
                    return bot.sendMessage(chatId, "❌ Cancelled.", { reply_markup: getAdminMenu() });
                }
            }
            
            if (state.startsWith('wait_link_val_') && text) {
                const cat = state.replace('wait_link_val_', '');
                data.settings[`link_${cat}`] = text;
                data.states[chatId] = 'none';
                saveData();
                return bot.sendMessage(chatId, "✅ Link successfully updated!", { reply_markup: getAdminMenu() });
            }
            
            if (state === 'wait_demo_video' && video) {
                data.demos.push(video);
                data.states[chatId] = 'none';
                saveData();
                return bot.sendMessage(chatId, "✅ Demo video added successfully!", { reply_markup: getAdminMenu() });
            }
            
            if (state === 'wait_premium_image' && photo) {
                data.settings.premium_image = photo;
                data.states[chatId] = 'none';
                saveData();
                return bot.sendMessage(chatId, "✅ Premium selection image updated successfully!", { reply_markup: getAdminMenu() });
            }
            
            if (state === 'wait_how_to_video' && video) {
                data.settings.how_to_video = video;
                data.states[chatId] = 'none';
                saveData();
                return bot.sendMessage(chatId, "✅ 'How To Get Premium' video updated successfully!", { reply_markup: getAdminMenu() });
            }

            // Admin Menu Button Actions
            if (text === 'Change UPI') {
                data.states[chatId] = 'wait_upi';
                saveData();
                return bot.sendMessage(chatId, "Send the new UPI ID:");
            } else if (text === 'Change Username') {
                data.states[chatId] = 'wait_username';
                saveData();
                return bot.sendMessage(chatId, "Send new support username (e.g., @newname):");
            } else if (text === 'Change Price') {
                data.states[chatId] = 'wait_price_category';
                saveData();
                const catMenu = { keyboard: [[{ text: 'Indian' }, { text: 'R@p' }], [{ text: 'Child' }, { text: 'All' }]], resize_keyboard: true };
                return bot.sendMessage(chatId, "Which category price do you want to change?", { reply_markup: catMenu });
            } else if (text === 'Add Links') {
                data.states[chatId] = 'wait_link_category';
                saveData();
                const catMenu = { keyboard: [[{ text: 'Indian' }, { text: 'R@p' }], [{ text: 'Child' }, { text: 'All' }]], resize_keyboard: true };
                return bot.sendMessage(chatId, "Which category link do you want to set?", { reply_markup: catMenu });
            } else if (text === 'Add Demo Video') {
                data.states[chatId] = 'wait_demo_video';
                saveData();
                return bot.sendMessage(chatId, "Send the video you want to add as a demo now:");
            } else if (text === 'Change Premium Image') {
                data.states[chatId] = 'wait_premium_image';
                saveData();
                return bot.sendMessage(chatId, "Send the new image for the Premium Section now:");
            } else if (text === 'Process Link Video') {
                data.states[chatId] = 'wait_how_to_video';
                saveData();
                return bot.sendMessage(chatId, "Send the video for 'How to Get Premium' now:");
            } else if (text === 'Check Users List') {
                const count = Object.keys(data.user_details).length;
                await bot.sendMessage(chatId, `📊 **Total Bot Users:** ${count}\n\n_Generating JSON file format..._`, { parse_mode: 'Markdown' });
                
                const jsonList = JSON.stringify(data.user_details, null, 4);
                const chunks = jsonList.match(/[\s\S]{1,3900}/g) || [];
                for (const chunk of chunks) {
                    await bot.sendMessage(chatId, `\`\`\`json\n${chunk}\n\`\`\``, { parse_mode: 'Markdown' });
                }
                return;
            } else if (text === 'Check History') {
                const appr = data.history.approved || 0;
                const rej = data.history.rejected || 0;
                return bot.sendMessage(chatId, `📈 **Payment History:**\n✅ Approved: ${appr}\n❌ Rejected: ${rej}`, { parse_mode: 'Markdown' });
            } else if (text === 'Remove Demo') {
                if (!data.demos || data.demos.length === 0) {
                    return bot.sendMessage(chatId, "No demo videos currently available.");
                } else {
                    for (let index = 0; index < data.demos.length; index++) {
                        const vid = data.demos[index];
                        const inlineBtn = { inline_keyboard: [[{ text: '❌ Delete Demo', callback_data: `deldemo_${index}` }]] };
                        await bot.sendVideo(chatId, vid, { caption: `Demo Video #${index + 1}`, reply_markup: inlineBtn }).catch(e => console.error("Remove Demo error:", e.message));
                    }
                    return;
                }
            }
        }

        if (state === 'wait_screenshot' && photo) {
            data.states[chatId] = 'none';
            
            const replyText = `⏳ Screenshot has been sent for approval\n\nYou will get private channel link within 20 minutes\n\nContact support ${data.settings.support} ✅`;
            await bot.sendPhoto(chatId, 'https://i.ibb.co/ymm1Pvsv/x.png', { caption: replyText }).catch(e => console.error(e.message));

            const adminCaption = `📢 New Payment Verification\n\n👤 User: ${firstName} (@${username})\n🆔 ID: ${chatId}\n\nApprove or Reject?`;
            const adminKeyboard = {
                inline_keyboard: [
                    [{ text: '✅ Approve', callback_data: `approve_${chatId}` }, { text: '❌ Reject', callback_data: `reject_${chatId}` }]
                ]
            };
            await bot.sendPhoto(adminId, photo, { caption: adminCaption, reply_markup: adminKeyboard }).catch(e => console.error(e.message));
            saveData();
            return;
        }

        if (text === '/start') {
            if (isAdmin) {
                const adminText = "Welcome Admin\nBot developed by @nglynx";
                return bot.sendMessage(chatId, adminText, { reply_markup: getAdminMenu() });
            } else {
                const userText = "Available Videos Collection?\n\n1. Mom Son videos - 5000+\n2. Sister Brother videos -2000+\n3. Cp kids videos - 15000+\n4. R@pe & Force videos-3000+\n5. Teen Girl. Videos - 6000+\n6. Indian Desi videos - 10000+\n7. Hidden cam videos - 2000+";
                const inlineKeyboard = {
                    inline_keyboard: [
                        [{ text: '💎 Get Premium', callback_data: 'get_premium' }],
                        [{ text: '🥵 Demo Videos', callback_data: 'view_demos' }],
                        [{ text: '✅ How To Get Premium', callback_data: 'how_to' }]
                    ]
                };
                
                const replyKeyboard = {
                    keyboard: [[{ text: '💎 Get Premium' }], [{ text: 'PAYMENT DONE ✅' }]],
                    resize_keyboard: true
                };
                
                await bot.sendPhoto(chatId, 'https://i.ibb.co/d4Ffygs4/x.jpg', { caption: userText, reply_markup: inlineKeyboard }).catch(e => console.error("Start menu error:", e.message));
                return bot.sendMessage(chatId, "👇 Menu 👇", { reply_markup: replyKeyboard });
            }
        }

        if (text === '/help' && isAdmin) {
            const helpText = "🛠 **Admin Commands & Tools:**\n\n" +
                        "🔹 **Change UPI:** Update the UPI ID where payments are sent.\n" +
                        "🔹 **Change Username:** Update the @support username shown to users.\n" +
                        "🔹 **Change Price / Add Links:** Modify prices and add unique channel links for different category packs.\n" +
                        "🔹 **Change Premium Image:** Customize the image shown on the 'Get Premium' menu.\n" +
                        "🔹 **Add / Remove Demo:** Manage videos in the demo section.\n" +
                        "🔹 **Check Users List:** See detailed list of users in JSON.\n" +
                        "🔹 **Check History:** See total approved and rejected payments.\n" +
                        "🔹 **/bdc <msg>:** Broadcast a message (or image/video with caption) to all users.";
            return bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
        }

        if (text === '💎 Get Premium') { return sendPremiumCategories(chatId); }
        if (text === 'PAYMENT DONE ✅') { return askForScreenshot(chatId); }
    });

    bot.on('callback_query', async (query) => {
        const callId = query.id;
        const chatId = query.message.chat.id.toString();
        const dataStr = query.data;
        const messageId = query.message.message_id;

        bot.answerCallbackQuery(callId).catch(() => {});

        if (dataStr === 'get_premium') { return sendPremiumCategories(chatId); }

        if (dataStr === 'how_to') {
            if (data.settings.how_to_video) {
                return bot.sendVideo(chatId, data.settings.how_to_video, { caption: "✅ **How To Get Premium / Process Link**\nWatch this video to understand the process.", parse_mode: 'Markdown' })
                .catch((err) => {
                    console.error("❌ SendVideo Error (How To):", err.message);
                    bot.sendMessage(chatId, "⚠️ Process video unavailable. *(Admin: The file_id is invalid. Please re-upload this video via the Admin Panel.)*", { parse_mode: 'Markdown' });
                });
            } else {
                return bot.sendMessage(chatId, "Video is not available right now. Please contact support.").catch(console.error);
            }
        }

        if (dataStr.startsWith('deldemo_')) {
            const index = parseInt(dataStr.replace('deldemo_', ''));
            if (data.demos[index] !== undefined) {
                data.demos.splice(index, 1);
                saveData();
                return bot.editMessageCaption("✅ Demo video deleted!", { chat_id: chatId, message_id: messageId }).catch(e => console.error(e.message));
            }
        }

        if (dataStr === 'view_demos') {
            if (!data.demos || data.demos.length === 0) {
                return bot.sendMessage(chatId, "No demo videos available right now.");
            } else {
                for (const vid of data.demos) {
                    const caption = "🎬 This video is only for demo\n💎 Click Get Premium for VIP channels access";
                    const inlineBtn = { inline_keyboard: [[{ text: '👉 Get Premium', callback_data: 'get_premium' }]] };
                    
                    bot.sendVideo(chatId, vid, { caption: caption, reply_markup: inlineBtn }).then(sentMsg => {
                        setTimeout(() => {
                            bot.deleteMessage(chatId, sentMsg.message_id).catch(() => {});
                        }, 5 * 60 * 1000);
                    }).catch((err) => {
                        console.error("❌ SendVideo Error (Demo):", err.message);
                        bot.sendMessage(chatId, "⚠️ A demo video failed to load. *(Admin: The file_id is invalid. Please remove and re-add demo videos via the Admin Panel.)*", { parse_mode: 'Markdown' }).catch(console.error);
                    });
                }
                
                const warningMsg = "⚠️ **All Demo Videos Will Be Deleted After 5 Minutes!** ⚠️\n\n_Get Premium now to enjoy unlimited lifetime access!_";
                bot.sendMessage(chatId, warningMsg, { parse_mode: 'Markdown' }).then(sentMsg => {
                    setTimeout(() => {
                        bot.deleteMessage(chatId, sentMsg.message_id).catch(() => {});
                    }, 5 * 60 * 1000);
                }).catch(e => console.error(e.message));
                return;
            }
        }

        if (dataStr.startsWith('pay_')) {
            const cat = dataStr.replace('pay_', '');
            const upi = data.settings.upi;
            const price = data.settings[`price_${cat}`] || "199";
            
            const payText = `🏷️ 𝐏𝐫𝐢𝐜𝐞: ₹${price}\n\n⏳ 𝐓𝐢𝐦𝐞 𝐋𝐞𝐟𝐭: 02:00\n\n1️⃣ 𝐒𝐜𝐚𝐧  |  2️⃣ 𝐏𝐚𝐲  |  3️⃣ 𝐂𝐥𝐢𝐜𝐤 ' PAYMENT DONE '`;
            const qrData = encodeURIComponent(`upi://pay?pa=${upi}&pn=Premium&am=${price}&cu=INR`);
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=35&data=${qrData}`;

            const paymentButtons = {
                inline_keyboard: [[{ text: 'PAYMENT DONE SEND SCREENSHOT ✅', callback_data: 'ask_screenshot' }]]
            };

            return bot.sendPhoto(chatId, qrUrl, { caption: payText, reply_markup: paymentButtons }).catch(e => console.error("QR Send Error:", e.message));
        }

        if (dataStr === 'ask_screenshot') { return askForScreenshot(chatId); }

        if (dataStr.startsWith('approve_')) {
            const userId = dataStr.replace('approve_', '');
            const linksKeyboard = {
                inline_keyboard: [
                    [{ text: 'Indian Link', callback_data: `sendlink_indian_${userId}` }],
                    [{ text: 'R@p Link ', callback_data: `sendlink_premium_${userId}` }],
                    [{ text: 'Child Link', callback_data: `sendlink_movies_${userId}` }],
                    [{ text: 'All in One Link', callback_data: `sendlink_all_${userId}` }]
                ]
            };
            await bot.editMessageCaption("✅ Payment Approved. Which link to send?", { chat_id: chatId, message_id: messageId, reply_markup: linksKeyboard }).catch(e => console.error(e.message));
            
            data.history.approved = (data.history.approved || 0) + 1;
            saveData();
            return;
        }

        if (dataStr.startsWith('reject_')) {
            const userId = dataStr.replace('reject_', '');
            const rejectText = `❌ YOUR PAYMENT WAS FAILED\nInvalid payment or fake payment\nContact support: ${data.settings.support}`;
            await bot.sendPhoto(userId, 'https://i.ibb.co/h147XCFh/x.png', { caption: rejectText }).catch(e => console.error(e.message));
            await bot.editMessageCaption(`❌ Payment Rejected for ${userId}.`, { chat_id: chatId, message_id: messageId }).catch(e => console.error(e.message));

            data.history.rejected = (data.history.rejected || 0) + 1;
            saveData();
            return;
        }

        if (dataStr.startsWith('sendlink_')) {
            const parts = dataStr.split('_');
            const pack = parts[1];
            const userId = parts[2];
            const link = data.settings[`link_${pack}`] || "https://t.me/fallback_link";
            
            const packName = pack.charAt(0).toUpperCase() + pack.slice(1);
            const successText = `✅ YOUR PAYMENT IS SUCCESSFULLY APPROVED\n\nClick below link to join private channel\n\nPack: ${packName}\nLink: ${link}\nContact support ${data.settings.support}`;
            
            await bot.sendPhoto(userId, 'https://i.ibb.co/Dfz7CSMV/x.png', { caption: successText }).catch(e => console.error(e.message));
            return bot.editMessageCaption(`✅ Link sent to user ${userId}.`, { chat_id: chatId, message_id: messageId }).catch(e => console.error(e.message));
        }
    });

    function sendPremiumCategories(chatId) {
        const img = data.settings.premium_image || 'https://i.ibb.co/9x38myC/x.jpg';
        const keyboard = {
            inline_keyboard: [
                [{ text: '👉 INDIAN VIDEOS 👈', callback_data: 'pay_indian' }],
                [{ text: '🤤 R@P VIDEOS 🤤', callback_data: 'pay_premium' }],
                [{ text: '👄 CHILD VIDEOS (50k+)😵', callback_data: 'pay_movies' }],
                [{ text: '🥵 ALL IN ONE 50+ GROUPS ✅', callback_data: 'pay_all' }]
            ]
        };

        bot.sendPhoto(chatId, img, { reply_markup: keyboard }).catch((err) => {
            console.error("❌ SendPhoto Error (Premium):", err.message);
            bot.sendMessage(chatId, "💎 **Premium Categories:**\n\n*(Admin: Custom image failed to load. Please update it in the Admin Menu.)*", { reply_markup: keyboard, parse_mode: 'Markdown' }).catch(console.error);
        });
    }

    function askForScreenshot(chatId) {
        data.states[chatId] = 'wait_screenshot';
        saveData();
        bot.sendMessage(chatId, "📸 𝙎𝙀𝙉𝘿 𝙎𝘾𝙍𝙀𝙀𝙉𝙎𝙃𝙊𝙏 𝙊𝙁 𝙔𝙊𝙐𝙍 𝙋𝘼𝙔𝙈𝙀𝙉𝙏 𝙁𝙊𝙍 𝙂𝙀𝙏 𝙋𝙍𝙀𝙈𝙄𝙐𝙈").catch(e => console.error(e.message));
    }
}

initBot();
