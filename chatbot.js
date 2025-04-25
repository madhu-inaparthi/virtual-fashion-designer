// To run this code you need to install the following dependencies:
// npm install @google/generative-ai readline dotenv
// npm install -D @types/node

// Import statements should be at the top
import { GoogleGenerativeAI } from '@google/generative-ai';
import readline from 'readline';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { MongoClient } from 'mongodb';
import path from 'path';
import { promises as fs } from 'fs';

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

// Add system prompt constant at the top after imports
const SYSTEM_PROMPT = `You are an expert virtual fashion designer with a deep understanding of style, trends, and personal aesthetics. Your job is to provide users with personalized fashion advice, outfit suggestions, and constructive feedback on styling choices. You must consider each user's preferences, body type, occasion, and mood when making recommendations. Additionally, you should reference the latest fashion trends and explain the reasoning behind your suggestions in a way that's clear, engaging, and educational. Your tone should be warm, professional, and encouraging, ensuring users feel confident in their style choices. Be ready to suggest creative ways to reuse existing wardrobe items and emphasize sustainability in fashion wherever possible, and should also read images which are sent by the user and give feedback. ALWAYS respond as this fashion designer persona, never break character.`;

// Update loadConversationHistory function
async function loadConversationHistory(userId, db) {
    try {
        if (db) {
            const collection = db.collection(COLLECTION_NAME);
            const userChat = await collection.findOne({ userId });
            if (userChat && userChat.history) {
                return userChat.history;
            }
        }
        // Return default history with system prompt
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
app.use(cors({
    origin: ['http://127.0.0.1:5500', 'http://localhost:3000'],
    methods: ['GET', 'POST']
}));

// Initialize AI and configuration
const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const modelName = 'gemini-2.0-flash';
const visionModelName = 'gemini-2.0-flash';
const config = {
    temperature: 0.6,
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
app.post('/chat', async (req, res) => {
    try {
        const { userId, message } = req.body;
        if (!userId || !message) {
            return res.status(400).json({ error: 'Missing userId or message' });
        }

        const db = await connectToMongoDB();
        let conversationHistory = await loadConversationHistory(userId, db);
        
        const model = ai.getGenerativeModel({ 
            model: modelName,
            generationConfig: config
        });
        
        const result = await model.generateContent({
            contents: [
                ...conversationHistory,
                { role: 'user', parts: [{ text: message }] }
            ]
        });
        
        const response = result.response.text();
        
        conversationHistory.push(
            { role: 'user', parts: [{ text: message }] },
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

// Image chat endpoint
app.post('/chat-with-image', upload.single('image'), async (req, res) => {
    try {
        const { userId, message } = req.body;
        const imageFile = req.file;
        
        if (!imageFile) {
            return res.status(400).json({ error: 'No image file provided' });
        }

        const db = await connectToMongoDB();
        let conversationHistory = await loadConversationHistory(userId, db);

        const model = ai.getGenerativeModel({ model: visionModelName });

        const parts = [
            { text: message || "Please analyze this outfit and provide feedback" },
            {
                inlineData: {
                    mimeType: imageFile.mimetype,
                    data: imageFile.buffer.toString('base64')
                }
            }
        ];

        const result = await model.generateContent({
            contents: [{ role: 'user', parts }]
        });

        const response = await result.response.text();

        conversationHistory.push(
            { role: 'user', parts: [{ text: message || "Please analyze this outfit and provide feedback" }] },
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
app.use(express.static('public'));

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});