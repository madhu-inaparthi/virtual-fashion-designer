import { GoogleGenerativeAI } from '@google/generative-ai';
import readline from 'readline';
import dotenv from 'dotenv';
import express from 'express';
import multer from 'multer';
import { MongoClient } from 'mongodb';
import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Load environment variables
dotenv.config();

// MongoDB Configuration
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const COLLECTION_NAME = 'conversations';

// MongoDB Connection Function
async function connectToMongoDB() {
    try {
        const client = await MongoClient.connect(MONGODB_URI);
        console.log('Connected to MongoDB');
        return client.db('fashion_ai');
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
        return null;
    }
}

// System Prompt
const SYSTEM_PROMPT = `You are an expert virtual fashion designer with a deep understanding of style, trends, and personal aesthetics. Your job is to provide users with personalized fashion advice, outfit suggestions, and constructive feedback on styling choices. You must consider each user's preferences, body type, occasion, and mood when making recommendations. Additionally, you should reference the latest fashion trends and explain the reasoning behind your suggestions in a way that's clear, engaging, and educational. Your tone should be warm, professional, and encouraging, ensuring users feel confident in their style choices. Be ready to suggest creative ways to reuse existing wardrobe items and emphasize sustainability in fashion wherever possible, and should also read images which are sent by the user and give feedback. ALWAYS respond as this fashion designer persona, never break character.`;

// Load Conversation History
async function loadConversationHistory(userId, db) {
    try {
        if (db) {
            const collection = db.collection(COLLECTION_NAME);
            const userChat = await collection.findOne({ userId });
            if (userChat && userChat.history) {
                return userChat.history;
            }
        }
        return [{
            role: 'user',
            parts: [{ text: SYSTEM_PROMPT }]
        }];
    } catch (error) {
        console.error('Error loading conversation history:', error);
        return [{
            role: 'user',
            parts: [{ text: SYSTEM_PROMPT }]
        }];
    }
}

// Save Conversation History
async function saveConversationHistory(userId, history, db) {
    try {
        if (db) {
            const collection = db.collection(COLLECTION_NAME);
            await collection.updateOne(
                { userId },
                { $set: { userId, history, updatedAt: new Date() } },
                { upsert: true }
            );
        }
    } catch (error) {
        console.error('Error saving conversation history:', error);
    }
}

// Initialize Express app
const app = express();
const PORT = 3000;

// Middleware setup
app.use(express.json());

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'https://tangerine-scone-7cf83d.netlify.app/');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const modelName = 'gemini-2.0-flash';
const config = {
    temperature: 0.4,
    topP: 1,
    topK: 32,
    maxOutputTokens: 4096,
};

// Multer configuration
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only images are allowed'));
        }
    }
});

// Chat endpoint
app.post('/chat', upload.single('image'), async (req, res) => {
    try {
        const { userId, message } = req.body;
        const imageFile = req.file;

        if (!userId || (!message && !imageFile)) {
            return res.status(400).json({ error: 'Missing userId or message/image' });
        }

        const db = await connectToMongoDB();
        let conversationHistory = await loadConversationHistory(userId, db);

        // Ensure system prompt is included
        if (conversationHistory.length === 0) {
            conversationHistory.push({
                role: 'system',
                parts: [{ text: SYSTEM_PROMPT }]
            });
        }

        const model = ai.getGenerativeModel({
            model: modelName,
            generationConfig: config
        });

        const parts = [];
        if (message) {
            parts.push({ text: message });
        }
        if (imageFile) {
            parts.push({
                inlineData: {
                    mimeType: imageFile.mimetype,
                    data: imageFile.buffer.toString('base64')
                }
            });
        }

        const result = await model.generateContent({
            contents: [...conversationHistory, { role: 'user', parts }]
        });

        const response = await result.response.text();

        conversationHistory.push(
            { role: 'user', parts },
            { role: 'model', parts: [{ text: response }] }
        );

        await saveConversationHistory(userId, conversationHistory, db);
        res.json({ response });
    } catch (error) {
        console.error('Detailed error:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

// Serve static files
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html on root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
