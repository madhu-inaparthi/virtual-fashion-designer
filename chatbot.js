// To run this code you need to install the following dependencies:
// npm install @google/generative-ai readline dotenv
// npm install -D @types/node

import { GoogleGenerativeAI } from '@google/generative-ai';
import readline from 'readline';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Check if API key is available
if (!process.env.GEMINI_API_KEY) {
  console.error('Error: GEMINI_API_KEY environment variable is not set.');
  console.log('Please create a .env file with your Gemini API key:');
  console.log('GEMINI_API_KEY=your_api_key_here');
  process.exit(1);
}

// Create readline interface for terminal input/output
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Initialize the Gemini AI client
const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Configure the model
const modelName = 'gemini-2.0-flash';
const config = {
  temperature: 0.6,
  generationConfig: {
    temperature: 0.6,
    topP: 0.95,
    topK: 64,
  },
};

// Define system prompt for the fashion designer persona
const systemPrompt = `You are an expert virtual fashion designer with a deep understanding of style, trends, and personal aesthetics. Your job is to provide users with personalized fashion advice, outfit suggestions, and constructive feedback on styling choices. You must consider each user's preferences, body type, occasion, and mood when making recommendations. Additionally, you should reference the latest fashion trends and explain the reasoning behind your suggestions in a way that's clear, engaging, and educational. Your tone should be warm, professional, and encouraging, ensuring users feel confident in their style choices. Be ready to suggest creative ways to reuse existing wardrobe items and emphasize sustainability in fashion wherever possible, and should also read images which are sent by the user and give feedback. ALWAYS respond as this fashion designer persona, never break character.`;

// Store conversation history
let conversationHistory = [
  {
    role: 'user',
    parts: [{ text: systemPrompt }]
  },
  {
    role: 'model',
    parts: [{ text: "I understand! I'm your expert virtual fashion designer. I'll provide personalized style advice, outfit suggestions, and constructive feedback while considering your preferences, body type, occasion, and mood. I'll stay up-to-date with trends and explain my recommendations clearly. My goal is to help you feel confident in your style choices while also suggesting sustainable fashion options. How can I help with your fashion needs today?" }]
  }
];

// Add MongoDB integration
import { MongoClient } from 'mongodb';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name properly in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = 'fashion_designer_db';
const COLLECTION_NAME = 'chat_histories';

// Connect to MongoDB
async function connectToMongoDB() {
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    console.log('Connected to MongoDB');
    return client.db(DB_NAME);
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
    // Fallback to file system if MongoDB connection fails
    console.log('Falling back to file system storage');
    return null;
  }
}

// Load conversation history for a user from MongoDB
async function loadConversationHistory(userId, db) {
  try {
    if (db) {
      // Try to load from MongoDB
      const collection = db.collection(COLLECTION_NAME);
      const userChat = await collection.findOne({ userId });
      
      if (userChat && userChat.history) {
        return userChat.history;
      }
    }
    
    // Fallback to file system or return default history
    return [
      {
        role: 'user',
        parts: [{ text: systemPrompt }]
      },
      {
        role: 'model',
        parts: [{ text: "I understand! I'm your expert virtual fashion designer. I'll provide personalized style advice, outfit suggestions, and constructive feedback while considering your preferences, body type, occasion, and mood. How can I help with your fashion needs today?" }]
      }
    ];
  } catch (error) {
    console.error('Error loading conversation history:', error);
    // Return default history if there's an error
    return getDefaultConversationHistory();
  }
}

// Save conversation history for a user to MongoDB
async function saveConversationHistory(userId, history, db) {
  try {
    if (db) {
      // Save to MongoDB
      const collection = db.collection(COLLECTION_NAME);
      await collection.updateOne(
        { userId },
        { $set: { userId, history, updatedAt: new Date() } },
        { upsert: true }
      );
      return;
    }
    
    // Fallback to file system
    const SESSIONS_DIR = path.join(__dirname, 'sessions');
    await fs.mkdir(SESSIONS_DIR, { recursive: true });
    const historyPath = path.join(SESSIONS_DIR, `${userId}.json`);
    await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
  } catch (error) {
    console.error('Error saving conversation history:', error);
  }
}

// Get default conversation history
function getDefaultConversationHistory() {
  return [
    {
      role: 'user',
      parts: [{ text: systemPrompt }]
    },
    {
      role: 'model',
      parts: [{ text: "I understand! I'm your expert virtual fashion designer. I'll provide personalized style advice, outfit suggestions, and constructive feedback while considering your preferences, body type, occasion, and mood. How can I help with your fashion needs today?" }]
    }
  ];
}

// Modify the chat function to use MongoDB
async function chat(userId = 'test-user') {
  // Connect to MongoDB
  const db = await connectToMongoDB();
  
  // Load conversation history for this user
  let conversationHistory = await loadConversationHistory(userId, db);
  
 
  
  // Start the conversation loop
  askQuestion(userId, db, conversationHistory);
}

// Update askQuestion to use MongoDB
function askQuestion(userId, db, conversationHistory) {
  rl.question('You: ', async (input) => {
    // Check for exit commands
    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      console.log('Goodbye! 👋');
      rl.close();
      return;
    }
    
    // Check for clear command
    if (input.toLowerCase() === 'clear') {
      // Reset conversation history but keep the system prompt
      conversationHistory = getDefaultConversationHistory();
      console.log('Conversation history cleared.');
      await saveConversationHistory(userId, conversationHistory, db);
      askQuestion(userId, db, conversationHistory);
      return;
    }
    
    try {
      // Add user message to history
      conversationHistory.push({
        role: 'user',
        parts: [{ text: input }]
      });
      
      // Prepare the model
      const model = ai.getGenerativeModel({ 
        model: modelName,
        generationConfig: config.generationConfig
      });
      
      // Get response from the model using the full conversation history
      console.log('AI: ');
      
      const result = await model.generateContentStream({
        contents: conversationHistory,
        generationConfig: config.generationConfig
      });
      
      let fullResponse = '';
      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        process.stdout.write(chunkText);
        fullResponse += chunkText;
      }
      console.log('\n');
      
      // Add AI response to history
      conversationHistory.push({
        role: 'model',
        parts: [{ text: fullResponse }]
      });
      
      // Save updated conversation history
      await saveConversationHistory(userId, conversationHistory, db);
      
      // Continue the conversation
      askQuestion(userId, db, conversationHistory);
    } catch (error) {
      console.error('Error:', error.message);
      askQuestion(userId, db, conversationHistory);
    }
  });
}

// Start the chat with a specific user ID
// In a real application, you would get this from your authentication system
chat('mongodb-user-123'); // Replace with actual user ID from your auth system

// Add Express.js imports at the top
import express from 'express';
import cors from 'cors';

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// API endpoint for chat
app.post('/chat', async (req, res) => {
  try {
    const { userId, message } = req.body;
    const db = await connectToMongoDB();
    let conversationHistory = await loadConversationHistory(userId, db);
    
    // Add user message to history
    conversationHistory.push({
      role: 'user',
      parts: [{ text: message }]
    });
    
    // Get AI response
    const model = ai.getGenerativeModel({ 
      model: modelName,
      generationConfig: config.generationConfig
    });
    
    const result = await model.generateContent({
      contents: conversationHistory,
      generationConfig: config.generationConfig
    });
    
    const response = result.response.text();
    
    // Add AI response to history
    conversationHistory.push({
      role: 'model',
      parts: [{ text: response }]
    });
    
    // Save updated history
    await saveConversationHistory(userId, conversationHistory, db);
    
    res.json({ response });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Fashion Designer Chatbot API running on port ${PORT}`);
});