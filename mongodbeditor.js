const TelegramBot = require('node-telegram-bot-api');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const BOT_TOKEN = "8895076785:AAGLd626qzY1GhRj4qwbogwPih730bM8ee8";
const ADMIN_CHAT_ID = 5291409360;

// Checks for MONGO_URL since that is what you have set in your environment
if (!process.env.MONGO_URL) {
    console.error("ERROR: MONGO_URL environment variable is not set. Please add it to your environment.");
    process.exit(1);
}

// Configured with specific polling parameters to prevent memory/conflict drops in multi-bot setups
const bot = new TelegramBot(BOT_TOKEN, { 
    polling: {
        interval: 300,
        autoStart: true,
        params: { timeout: 10 }
    } 
});

let mongoClient = null;

const adminState = {
    tempFilePath: null,
    selectedDb: null,
    selectedCollection: null,
    dbList: [],
    colList: []
};

async function getMongoClient() {
    if (!mongoClient) {
        console.log("Connecting to MongoDB...");
        mongoClient = new MongoClient(process.env.MONGO_URL);
        await mongoClient.connect();
        console.log("✅ MongoDB connected successfully!");
    }
    return mongoClient;
}

async function cleanupState() {
    if (adminState.tempFilePath) {
        try {
            if (fs.existsSync(adminState.tempFilePath)) {
                await fsp.unlink(adminState.tempFilePath);
                console.log(`🗑️ Temp file deleted: ${adminState.tempFilePath}`);
            }
        } catch (error) {
            console.error("Error deleting temp file:", error.message);
        }
        adminState.tempFilePath = null;
    }
    adminState.selectedDb = null;
    adminState.selectedCollection = null;
    adminState.dbList = [];
    adminState.colList = [];
}

function checkAdmin(chatId) {
    return chatId === ADMIN_CHAT_ID;
}

bot.on('message', (msg) => {
    if (!msg.text || msg.text.startsWith('/start')) return;
    if (!checkAdmin(msg.chat.id)) {
        bot.sendMessage(msg.chat.id, "Access Denied").catch(() => {});
    }
});

bot.onText(/\/start/, async (msg) => {
    if (!checkAdmin(msg.chat.id)) return;
    
    console.log("Admin sent /start command.");
    await cleanupState(); 
    await bot.sendMessage(ADMIN_CHAT_ID, "📂 Send me a .json file to replace MongoDB data.");
});

bot.on('document', async (msg) => {
    if (!checkAdmin(msg.chat.id)) return;

    const doc = msg.document;
    
    if (!doc.file_name || !doc.file_name.toLowerCase().endsWith('.json')) {
        console.log("Rejected: File format is not .json");
        return bot.sendMessage(ADMIN_CHAT_ID, "❌ Invalid format. Please upload a .json document only.");
    }

    try {
        await cleanupState();
        const waitMsg = await bot.sendMessage(ADMIN_CHAT_ID, "📥 Downloading file...");
        
        // Use os temp directory for storage
        const filePath = await bot.downloadFile(doc.file_id, os.tmpdir());
        adminState.tempFilePath = filePath;
        console.log(`✅ File downloaded successfully to: ${filePath}`);

        bot.deleteMessage(ADMIN_CHAT_ID, waitMsg.message_id).catch(() => {});
        await showDatabases(ADMIN_CHAT_ID);
        
    } catch (error) {
        console.error("Telegram download error:", error);
        bot.sendMessage(ADMIN_CHAT_ID, "❌ Error downloading from Telegram: " + error.message);
    }
});

async function showDatabases(chatId) {
    try {
        const client = await getMongoClient();
        const adminDb = client.db().admin();
        const result = await adminDb.listDatabases();
        
        adminState.dbList = result.databases ? result.databases.map(db => db.name) : [];

        if (adminState.dbList.length === 0) {
            return bot.sendMessage(chatId, "❌ No databases found.");
        }

        const keyboard = [];
        for (let i = 0; i < adminState.dbList.length; i += 2) {
            const row = [];
            row.push({ text: adminState.dbList[i], callback_data: `db_${i}` });
            if (adminState.dbList[i + 1]) {
                row.push({ text: adminState.dbList[i + 1], callback_data: `db_${i + 1}` });
            }
            keyboard.push(row);
        }

        await bot.sendMessage(chatId, "🗄 Select a Database:", {
            reply_markup: { inline_keyboard: keyboard }
        });
    } catch (error) {
        console.error("DB Fetch Error:", error);
        bot.sendMessage(chatId, "❌ Database fetch failed: " + error.message);
        await cleanupState();
    }
}

async function showCollections(messageId, dbName) {
    try {
        const client = await getMongoClient();
        const db = client.db(dbName);
        const collections = await db.listCollections().toArray();
        adminState.colList = collections ? collections.map(c => c.name) : [];

        if (adminState.colList.length === 0) {
            await bot.editMessageText(`🗄 Database: ${dbName}\n❌ No collections found inside this database.`, {
                chat_id: ADMIN_CHAT_ID,
                message_id: messageId
            });
            await cleanupState();
            return;
        }

        const keyboard = [];
        for (let i = 0; i < adminState.colList.length; i += 2) {
            const row = [];
            row.push({ text: adminState.colList[i], callback_data: `col_${i}` });
            if (adminState.colList[i + 1]) {
                row.push({ text: adminState.colList[i + 1], callback_data: `col_${i + 1}` });
            }
            keyboard.push(row);
        }

        await bot.editMessageText(`🗄 Database: ${dbName}\n📑 Now select a Collection:`, {
            chat_id: ADMIN_CHAT_ID,
            message_id: messageId,
            reply_markup: { inline_keyboard: keyboard }
        });
    } catch (error) {
        console.error("Collection fetch error:", error);
        bot.sendMessage(ADMIN_CHAT_ID, "❌ Collections fetch failed: " + error.message);
        await cleanupState();
    }
}

async function sendConfirmation(messageId) {
    const text = `⚠️ Database: ${adminState.selectedDb}\n⚠️ Collection: ${adminState.selectedCollection}\n\nThis operation will permanently delete every document.`;
    const keyboard = [
        [{ text: "✅ Replace", callback_data: "confirm_yes" }],
        [{ text: "❌ Cancel", callback_data: "confirm_no" }]
    ];

    await bot.editMessageText(text, {
        chat_id: ADMIN_CHAT_ID,
        message_id: messageId,
        reply_markup: { inline_keyboard: keyboard }
    });
}

async function executeReplacement(messageId) {
    if (!adminState.tempFilePath || !fs.existsSync(adminState.tempFilePath)) {
        return bot.editMessageText("❌ Error: JSON file is missing from memory. Please upload it again.", {
            chat_id: ADMIN_CHAT_ID,
            message_id: messageId
        });
    }

    const startTime = Date.now();
    await bot.editMessageText("⏳ Replacing data, please wait...", { 
        chat_id: ADMIN_CHAT_ID, 
        message_id: messageId 
    });

    try {
        const fileData = await fsp.readFile(adminState.tempFilePath, 'utf8');
        let jsonData;
        
        try {
            jsonData = JSON.parse(fileData);
        } catch (err) {
            throw new Error("Invalid JSON File. Please check the syntax.");
        }

        if (!jsonData || (Array.isArray(jsonData) && jsonData.length === 0) || (Object.keys(jsonData).length === 0)) {
            throw new Error("The provided JSON file is empty.");
        }

        const client = await getMongoClient();
        const collection = client.db(adminState.selectedDb).collection(adminState.selectedCollection);

        const deleteResult = await collection.deleteMany({});
        const deletedCount = deleteResult.deletedCount;
        
        let insertedCount = 0;
        if (Array.isArray(jsonData)) {
            const insertResult = await collection.insertMany(jsonData);
            insertedCount = insertResult.insertedCount;
        } else if (typeof jsonData === 'object') {
            await collection.insertOne(jsonData);
            insertedCount = 1;
        } else {
            throw new Error("The JSON file must contain a valid Object or Array.");
        }

        const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);

        const successMsg = `✅ Replace Completed\n\nDatabase: ${adminState.selectedDb}\nCollection: ${adminState.selectedCollection}\nDeleted Documents: ${deletedCount}\nInserted Documents: ${insertedCount}\nExecution Time: ${executionTime}s`;

        await bot.editMessageText(successMsg, {
            chat_id: ADMIN_CHAT_ID,
            message_id: messageId
        });
        
        console.log("✅ Data replaced successfully!");

    } catch (error) {
        console.error("Replacement Error:", error);
        await bot.editMessageText(`❌ Replacement error:\n\n${error.message}`, {
            chat_id: ADMIN_CHAT_ID,
            message_id: messageId
        });
    } finally {
        await cleanupState();
    }
}

bot.on('callback_query', async (query) => {
    // Safety check added here to prevent the undefined crash
    if (!query || !query.data) return;

    const data = query.data;
    const messageId = query.message.message_id;

    if (!checkAdmin(query.message.chat.id)) {
        return bot.answerCallbackQuery(query.id, { text: "Access Denied", show_alert: true });
    }

    try {
        if (data.startsWith('db_')) {
            const index = parseInt(data.replace('db_', ''));
            adminState.selectedDb = adminState.dbList[index];
            await showCollections(messageId, adminState.selectedDb);
            bot.answerCallbackQuery(query.id).catch(() => {});
            
        } else if (data.startsWith('col_')) {
            const index = parseInt(data.replace('col_', ''));
            adminState.selectedCollection = adminState.colList[index];
            await sendConfirmation(messageId);
            bot.answerCallbackQuery(query.id).catch(() => {});
            
        } else if (data === 'confirm_yes') {
            bot.answerCallbackQuery(query.id).catch(() => {});
            await executeReplacement(messageId);
            
        } else if (data === 'confirm_no') {
            bot.answerCallbackQuery(query.id).catch(() => {});
            await bot.editMessageText("❌ Replacement cancelled.", {
                chat_id: ADMIN_CHAT_ID,
                message_id: messageId
            });
            await cleanupState();
        }
    } catch (error) {
        console.error("Callback query error:", error);
        bot.sendMessage(ADMIN_CHAT_ID, "❌ System error: " + error.message).catch(() => {});
    }
});

console.log("🤖 MongoDB Editor Bot is online and waiting for commands...");
