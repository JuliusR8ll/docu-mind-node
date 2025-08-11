import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Groq from 'groq-sdk';
import multer from 'multer';
import { PdfReader } from 'pdfreader';
import XLSX from 'xlsx';
import csv from 'csv-parser';
import fs from 'fs';
import path from 'path';
import os from 'os';
import levenshtein from 'fast-levenshtein';
import nlp from 'compromise';

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { fileURLToPath } from 'url'; // NEW import
import { dirname } from 'path';     // NEW import
import { v4 as uuidv4 } from 'uuid';

// NEW IMPORTS FOR DATE/TIME ZONE HANDLING
import {toZonedTime } from 'date-fns-tz'; // Correct import for utcToZonedTime
import { format } from 'date-fns';  
dotenv.config();

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

const app = express();
const PORT = process.env.PORT || 8000;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkeythatshouldbeverylongandrandom'; // !! USE A STRONG, RANDOM KEY IN YOUR .ENV FILE !!

// NEW: User data storage (for demonstration, in a JSON file)
const USERS_FILE = path.join(__dirname, 'users.json');
const ORDERS_FILE = path.join(__dirname, 'orders.json');

// Helper to read users from file
const readUsers = () => {
    try {
        if (!fs.existsSync(USERS_FILE)) {
            fs.writeFileSync(USERS_FILE, '[]'); // Create empty array if file doesn't exist
        }
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading users.json:', error);
        return [];
    }
};

// Helper to write users to file
const writeUsers = (users) => {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
};

// File conversion functions
function convertExcelToText(buffer) {
    try {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        let text = '';
        let structuredData = []; // Array to hold {item_name, price, available_quantity}

        workbook.SheetNames.forEach(sheetName => {
            const sheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(sheet);
            
            if (jsonData.length === 0) {
                text += `{"sheet":"${sheetName}","note":"empty"}\n`;
            } else {
                text += `\n=== Sheet: ${sheetName} ===\n`;
                jsonData.forEach((row, index) => {
                    text += `Row ${index + 1}: ${JSON.stringify(row)}\n`;
                    
                    // Attempt to extract item_name, price, quantity from row
                    // ASSUMPTION: Your Excel/CSV will have columns like 'Item Name', 'Price', 'Quantity'
                    // Adjust these keys ('Item Name', 'Price', 'Quantity') to match your actual catalog file's column headers
                    const itemName = row['Item Name'] || row['item'] || row['Item'];
                    const price = parseFloat(row['Price']) || parseFloat(row['price']) || 0;
                    const quantity = parseInt(row['Quantity']) || parseInt(row['quantity']) || parseInt(row['Stock']) || 0;

                    if (itemName && price > 0 && quantity >= 0) {
                        structuredData.push({
                            item_name: String(itemName).trim(),
                            price: price,
                            available_quantity: quantity
                        });
                    }
                });
            }
        });

        return { text, structuredData }; // Return both text and structured data
    } catch (err) {
        throw new Error('Failed to read Excel file: ' + err.message);
    }
}

function convertCsvToText(buffer) {
    return new Promise((resolve, reject) => {
        let text = '';
        let structuredData = []; // Array to hold {item_name, price, available_quantity}
        let rowCount = 0;
        
        try {
            const tempFile = path.join(os.tmpdir(), `csv_${Date.now()}.csv`);
            fs.writeFileSync(tempFile, buffer);
            
            fs.createReadStream(tempFile, { encoding: 'utf8' })
                .pipe(csv())
                .on('data', (row) => {
                    rowCount++;
                    text += `Row ${rowCount}: ${JSON.stringify(row)}\n`;

                    // Attempt to extract item_name, price, quantity from row
                    // ASSUMPTION: Your Excel/CSV will have columns like 'Item Name', 'Price', 'Quantity'
                    // Adjust these keys ('Item Name', 'Price', 'Quantity') to match your actual catalog file's column headers
                    const itemName = row['Item Name'] || row['item'] || row['Item'];
                    const price = parseFloat(row['Price']) || parseFloat(row['price']) || 0;
                    const quantity = parseInt(row['Quantity']) || parseInt(row['quantity']) || parseInt(row['Stock']) || 0;

                    if (itemName && price > 0 && quantity >= 0) {
                        structuredData.push({
                            item_name: String(itemName).trim(),
                            price: price,
                            available_quantity: quantity
                        });
                    }
                })
                .on('end', () => {
                    fs.unlinkSync(tempFile);
                    resolve({ text, structuredData }); // Resolve with both text and structured data
                })
                .on('error', (err) => {
                    if (fs.existsSync(tempFile)) {
                        fs.unlinkSync(tempFile);
                    }
                    reject(new Error('Failed to parse CSV: ' + err.message));
                });
        } catch (err) {
            reject(new Error('CSV stream error: ' + err.message));
        }
    });
}

// Typo correction and spell checking functions
function createCommonWords() {
    // Common words dictionary for spell checking
    return [
        // Question words
        'what', 'where', 'when', 'why', 'who', 'how', 'which', 'whose',
        // Common verbs
        'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
        'do', 'does', 'did', 'will', 'would', 'could', 'should', 'can', 'may', 'might',
        'show', 'tell', 'find', 'get', 'give', 'take', 'make', 'come', 'go', 'see',
        'know', 'think', 'feel', 'want', 'need', 'use', 'work', 'try', 'ask', 'help',
        'look', 'seem', 'turn', 'start', 'call', 'keep', 'become', 'leave', 'put',
        'mean', 'say', 'move', 'play', 'run', 'live', 'believe', 'hold', 'bring',
        'happen', 'write', 'sit', 'stand', 'lose', 'pay', 'meet', 'include', 'continue',
        // Document/data related words
        'document', 'file', 'text', 'data', 'information', 'content', 'page', 'section',
        'chapter', 'paragraph', 'line', 'word', 'sentence', 'title', 'heading',
        'summary', 'analysis', 'report', 'table', 'chart', 'graph', 'figure',
        'number', 'amount', 'total', 'sum', 'average', 'count', 'percentage',
        'calculate', 'compute', 'analyze', 'examine', 'review', 'check', 'compare',
        'explain', 'describe', 'summarize', 'outline', 'detail', 'discuss',
        // Common adjectives
        'main', 'important', 'key', 'major', 'minor', 'significant', 'relevant',
        'specific', 'general', 'particular', 'certain', 'different', 'similar',
        'same', 'new', 'old', 'first', 'last', 'next', 'previous', 'current',
        'final', 'initial', 'original', 'complete', 'full', 'partial', 'total',
        // Prepositions and conjunctions
        'in', 'on', 'at', 'by', 'for', 'with', 'from', 'to', 'of', 'about',
        'through', 'during', 'before', 'after', 'above', 'below', 'up', 'down',
        'over', 'under', 'between', 'among', 'and', 'or', 'but', 'so', 'if',
        'because', 'since', 'while', 'although', 'however', 'therefore', 'thus',
        // Articles and pronouns
        'the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'your',
        'his', 'her', 'its', 'our', 'their', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
        // Common nouns
        'time', 'year', 'day', 'week', 'month', 'hour', 'minute', 'second',
        'person', 'people', 'man', 'woman', 'child', 'group', 'company', 'business',
        'place', 'area', 'country', 'state', 'city', 'home', 'house', 'office',
        'problem', 'question', 'answer', 'issue', 'solution', 'result', 'effect',
        'cause', 'reason', 'purpose', 'goal', 'objective', 'plan', 'strategy',
        'method', 'approach', 'way', 'process', 'system', 'program', 'project',
        // Numbers and quantities
        'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
        'hundred', 'thousand', 'million', 'billion', 'many', 'few', 'several', 'some',
        'all', 'most', 'more', 'less', 'much', 'little', 'enough', 'too'
    ];
}

function createTypoPatterns() {
    // Common typo patterns and their corrections
    return {
        // Common letter swaps
        'teh': 'the',
        'adn': 'and',
        'andd': 'and',
        'nad': 'and',
        'wiht': 'with',
        'wtih': 'with',
        'hte': 'the',
        'fo': 'of',
        'ont': 'not',
        'nto': 'not',
        'cna': 'can',
        'acn': 'can',
        'taht': 'that',
        'thta': 'that',
        'waht': 'what',
        'hwat': 'what',
        'wnat': 'want',
        'awnt': 'want',
        'form': 'from',
        'fro': 'for',
        
        // Question word typos
        'whta': 'what',
        'wha': 'what',
        'wat': 'what',
        'whats': 'what is',
        'wher': 'where',
        'whre': 'where',
        'wehn': 'when',
        'whe': 'when',
        'whne': 'when',
        'hwo': 'how',
        'ho': 'how',
        'woh': 'who',
        'wyh': 'why',
        'wy': 'why',
        'whihc': 'which',
        'whic': 'which',
        'wich': 'which',
        
        // Document-related typos
        'documnet': 'document',
        'documen': 'document',
        'documetn': 'document',
        'sumary': 'summary',
        'summray': 'summary',
        'sumarize': 'summarize',
        'anaylze': 'analyze',
        'analayze': 'analyze',
        'analize': 'analyze',
        'calcualte': 'calculate',
        'calulate': 'calculate',
        'expalin': 'explain',
        'expain': 'explain',
        'explian': 'explain',
        'desribe': 'describe',
        'descirbe': 'describe',
        'descrbie': 'describe',
        'infomation': 'information',
        'informaton': 'information',
        'informtion': 'information',
        'conten': 'content',
        'contnet': 'content',
        'cotent': 'content',
        
        // Common verb typos
        'shwo': 'show',
        'sho': 'show',
        'tel': 'tell',
        'tll': 'tell',
        'finde': 'find',
        'fin': 'find',
        'gt': 'get',
        'ge': 'get',
        'giv': 'give',
        'gve': 'give',
        'tak': 'take',
        'mak': 'make',
        'mae': 'make',
        'com': 'come',
        'se': 'see',
        'no': 'know',
        'kno': 'know',
        'konw': 'know',
        'knwo': 'know',
        'thnk': 'think',
        'thikn': 'think',
        'thihnk': 'think',
        'fel': 'feel',
        'wan': 'want',
        'wnt': 'want',
        'ned': 'need',
        'nee': 'need',
        'us': 'use',
        'ues': 'use',
        'usr': 'use',
        'wor': 'work',
        'wrk': 'work',
        'tr': 'try',
        'as': 'ask',
        'hel': 'help',
        'lok': 'look',
        'loo': 'look',
        'loko': 'look',
        
        // Common adjective/adverb typos
        'mai': 'main',
        'man': 'main',
        'importnat': 'important',
        'importan': 'important',
        'improtant': 'important',
        'ke': 'key',
        'ky': 'key',
        'majo': 'major',
        'majro': 'major',
        'mino': 'minor',
        'sinificant': 'significant',
        'significan': 'significant',
        'significat': 'significant',
        'relevan': 'relevant',
        'revelant': 'relevant',
        'specifi': 'specific',
        'specifc': 'specific',
        'genral': 'general',
        'genera': 'general',
        'particulr': 'particular',
        'particula': 'particular',
        'certai': 'certain',
        'diferent': 'different',
        'differnt': 'different',
        'differen': 'different',
        'simila': 'similar',
        'similiar': 'similar',
        'sam': 'same',
        'ne': 'new',
        'ol': 'old',
        'firs': 'first',
        'las': 'last',
        'nex': 'next',
        'previou': 'previous',
        'prevous': 'previous',
        'curren': 'current',
        'curret': 'current',
        'fina': 'final',
        'finl': 'final',
        'initia': 'initial',
        'inital': 'initial',
        'origina': 'original',
        'orignal': 'original',
        'complet': 'complete',
        'comlete': 'complete',
        'ful': 'full',
        'partia': 'partial',
        'partail': 'partial',
        'tota': 'total',
        'toal': 'total'
    };
}

function correctCommonTypos(text) {
    if (!text || typeof text !== 'string') return text;
    
    const typoPatterns = createTypoPatterns();
    let corrected = text.toLowerCase();
    
    // Apply common typo corrections
    for (const [typo, correction] of Object.entries(typoPatterns)) {
        const regex = new RegExp(`\\b${typo}\\b`, 'gi');
        corrected = corrected.replace(regex, correction);
    }
    
    return corrected;
}

function findClosestWord(word, dictionary, threshold = 3) {
    if (!word || word.length < 2) return null;
    
    let bestMatch = null;
    let bestDistance = threshold;
    
    for (const dictWord of dictionary) {
        if (dictWord === word) return word; // Exact match
        
        const distance = levenshtein.get(word.toLowerCase(), dictWord.toLowerCase());
        
        // Consider it a match if distance is small enough relative to word length
        const maxAllowedDistance = Math.min(threshold, Math.ceil(word.length / 3));
        
        if (distance < maxAllowedDistance && distance < bestDistance) {
            bestDistance = distance;
            bestMatch = dictWord;
        }
    }
    
    return bestMatch;
}

function correctSpelling(text) {
    if (!text || typeof text !== 'string') return { corrected: text, corrections: [] };
    
    // First, apply common typo corrections
    let corrected = correctCommonTypos(text);
    let corrections = [];
    
    // If the text changed, note the correction
    if (corrected !== text.toLowerCase()) {
        corrections.push(`Applied common typo fixes: "${text}" -> "${corrected}"`);
    }
    
    // Then apply NLP-based corrections
    try {
        const doc = nlp(corrected);
        const words = doc.terms().out('array');
        const commonWords = createCommonWords();
        
        let hasChanges = false;
        const correctedWords = words.map(word => {
            if (word.length < 3) return word; // Skip very short words
            
            const cleanWord = word.toLowerCase().replace(/[^a-zA-Z]/g, '');
            if (!cleanWord) return word;
            
            const suggestion = findClosestWord(cleanWord, commonWords);
            if (suggestion && suggestion !== cleanWord) {
                corrections.push(`"${cleanWord}" -> "${suggestion}"`);
                hasChanges = true;
                return word.replace(cleanWord, suggestion);
            }
            
            return word;
        });
        
        if (hasChanges) {
            corrected = correctedWords.join(' ');
        }
        
    } catch (error) {
        console.warn('NLP spell correction failed:', error.message);
    }
    
    return {
        corrected: corrected,
        corrections: corrections,
        hasCorrections: corrections.length > 0
    };
}

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { 
        fileSize: 50 * 1024 * 1024, // 50MB limit
        files: 10 // Maximum 10 files
    },
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
            'application/vnd.ms-excel', // .xls
            'text/csv',
            'application/csv'
        ];
        
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only PDF, Excel (.xlsx, .xls), and CSV files are allowed'), false);
        }
    }
});

let pdfContent = '';
let isProcessed = false;

let processedCatalogData = [];
// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (token == null) {
        return res.status(401).json({ error: 'Authentication token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.error('JWT verification failed:', err.message);
            // Token is invalid or expired
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user; // Attach user payload to request (id, username, phone_number)
        next(); // Proceed to the next middleware/route handler
    });
};

app.post('/register', async (req, res) => {
    const { username, phone_number, password } = req.body;

    if (!username || !phone_number || !password) {
        return res.status(400).json({ error: 'Username, phone number, and password are required' });
    }

    const users = readUsers();

    if (users.find(u => u.username === username)) {
        return res.status(409).json({ error: 'Username already exists' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10); // Hash password with salt rounds = 10
        const newUser = {
            id: Date.now().toString(), // Simple unique ID for demo
            username,
            phone_number,
            password: hashedPassword
        };

        users.push(newUser);
        writeUsers(users);

        console.log(`✅ User registered: ${username}`);
        res.status(201).json({ message: 'User registered successfully!' });

    } catch (error) {
        console.error('❌ Registration error:', error);
        res.status(500).json({ error: 'Failed to register user', details: error.message });
    }
});

// Login user
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    const users = readUsers();
    const user = users.find(u => u.username === username);

    if (!user) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }

    try {
        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        // Create JWT
        const token = jwt.sign(
            { id: user.id, username: user.username, phone_number: user.phone_number },
            JWT_SECRET,
            { expiresIn: '1h' } // Token expires in 1 hour
        );

        console.log(`✅ User logged in: ${username}`);
        res.json({
            message: 'Logged in successfully!',
            token,
            user: { // Send back minimal user data
                username: user.username,
                phone_number: user.phone_number
            }
        });

    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({ error: 'Failed to log in', details: error.message });
    }
});

// Logout user (client-side focused for JWTs, but route validates token)
app.post('/logout', authenticateToken, (req, res) => {
    // For JWTs, logout is primarily handled client-side by deleting the token.
    // This backend route just confirms the token is valid before acknowledging.
    console.log(`✅ User logged out (token validated): ${req.user.username}`);
    res.json({ message: 'Logged out successfully!' });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        service: 'Docu-Mind Backend',
        ai_provider: 'Groq',
        models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
        features: ['PDF Processing', 'Excel Processing', 'CSV Processing', 'Question Answering', 'Document Analysis', 'Spell Check & Typo Correction'],
        supported_formats: ['PDF', 'Excel (.xlsx, .xls)', 'CSV'],
        timestamp: new Date().toISOString()
    });
});


app.post('/conversational_order', authenticateToken, async (req, res) => {
    // chatHistory: an array of { role: 'user'/'assistant', content: '...' }
    // currentStep: the current logical step ('item_selection', 'quantity_selection', etc.)
    // availableItems: the list of item names from the catalog
    // userInput: the latest message from the user
    const { chatHistory, currentStep, availableItems, userInput } = req.body;

    if (!chatHistory || !currentStep || !userInput) {
        return res.status(400).json({ error: 'Chat history, current step, and user input are required.' });
    }

    // Define the system prompt based on the current step
    let systemPrompt;
    // NEW: Add variables for model and response format
    let model = "llama-3.1-8b-instant"; // Default to a fast model
    let responseFormat = null; // Default to no specific format

    switch (currentStep) {
        case 'item_selection':
            model = "llama-3.3-70b-versatile";
            responseFormat = { type: "json_object" };

            systemPrompt = `You are a smart and friendly restaurant ordering assistant. Your task is to intelligently match the user's input to an item from the menu, even if there are typos or it's a partial match.
            
            The user wants to order an item. Here is the list of available items: [${availableItems.join(', ')}].

            Analyze the user's last message.
            - If their message clearly refers to one of the items in the list (e.g., "Classic" should match "Classic Burger", "Fren Frie" should match "French Fries"), identify the best match.
            - If their message contains words like "done", "proceed", "finished", "complete", or "checkout", set match to "done" to indicate they want to proceed to delivery details.
            - If their message is ambiguous or does not match any item, you must conclude there is no match.

            You MUST respond in a valid JSON format with two keys:
            1. "match": A string containing the exact item name from the provided list if a good match is found. If they want to proceed to delivery details, set this to "done". If no match is found, this MUST be the string "None".
            2. "response": A short, friendly, conversational string to send back to the user. 
               - If a match is found, confirm the item and ask for the quantity (e.g., "Classic Burger, great choice! How many would you like?").
               - If they want to proceed (match is "done"), acknowledge and confirm moving to delivery details.
               - If no match is found, politely tell the user you couldn't find that item and gently guide them by mentioning one or two other items from the list (e.g., "Hmm, I don't see 'Fren Frie' on our menu. We do have 'French Fries' and 'Classic Burger' though. Did you mean one of those?"). Be creative and vary your responses.
            
            Example of a good match response: {"match": "Classic Burger", "response": "Classic Burger, an excellent choice! How many would you like to order?"}
            Example of a done response: {"match": "done", "response": "Perfect! Let's proceed with your delivery details."}
            Example of a no-match response: {"match": "None", "response": "Sorry, I couldn't find 'sushi' on our menu today. Perhaps you'd like our popular Margherita Pizza instead?"}`
            break;

        case 'quantity_selection':
            systemPrompt = `You are a friendly restaurant ordering assistant. The user has just selected a valid item and quantity. Your goal is to ask for the delivery date in a conversational way. For example: "Great! And when would you like that delivered? (e.g., YYYY-MM-DD)".`;
            break;
        case 'date_selection':
            systemPrompt = `You are a friendly restaurant ordering assistant. The user has just provided a valid delivery date. Your goal is to ask them to select a part of the day and a specific time for delivery using the dropdowns provided. Keep it short and friendly.`;
            break;
        case 'time_selection':
            systemPrompt = `You are a friendly restaurant ordering assistant. The user has just confirmed their delivery time. Your goal is to thank them and tell them you are preparing their order summary. Keep it short and positive.`;
            break;
        default:
            systemPrompt = `You are a friendly and helpful AI assistant.`;
    }

    try {
        const messages = [
            { role: "system", content: systemPrompt },
            ...chatHistory, // The previous turns of the conversation
            { role: "user", content: userInput } // The user's latest message
        ];

        const completion = await groq.chat.completions.create({
            messages: messages,
            model: model, // MODIFIED: Uses the dynamically selected model
            max_tokens: 200, // MODIFIED: Slightly increased for JSON
            temperature: 0.7,
            response_format: responseFormat, // MODIFIED: Applies JSON format when needed
            stream: false
        });

        // MODIFIED: This entire block is new. It handles both JSON and plain text responses.
        let aiResponse = completion.choices[0]?.message?.content;

        if (currentStep === 'item_selection') {
            // If we expect JSON, parse it and send the structured object back to the frontend
            try {
                const structuredResponse = JSON.parse(aiResponse);
                res.json(structuredResponse);
            } catch (jsonError) {
                console.error("Failed to parse JSON response from LLM:", aiResponse);
                // Send a graceful fallback if JSON parsing fails
                res.status(500).json({
                    error: "The AI response was not in the expected format. Please try again."
                });
            }
        } else {
            // For other steps, just send the plain text response
            res.json({ response: aiResponse || "Let's continue!" });
        }

    } catch (error) {
        console.error('❌ Conversational Order error:', error);
        res.status(500).json({
            error: 'Failed to generate a response',
            details: error.message
        });
    }
});
// // Chat endpoint - answer questions using Groq
// app.post('/chat', async (req, res) => {
//     try {
//         const { message, context = '' } = req.body;

//         if (!message) {
//             return res.status(400).json({ error: 'Message is required' });
//         }

//         console.log('📝 Question received:', message);

//         // Prepare the prompt with context if provided
//         let prompt = message;
//         if (context.trim()) {
//             prompt = `Context: ${context}\n\nQuestion: ${message}\n\nPlease answer the question based on the context provided. If the context doesn't contain relevant information, please say so.`;
//         }

//         // Try primary model first
//         let completion;
//         let modelUsed;
        
//         try {
//             completion = await groq.chat.completions.create({
//                 messages: [
//                     {
//                         role: "system",
//                         content: "You are a helpful AI assistant. Answer questions clearly and concisely. If you're given context, base your answer on that context."
//                     },
//                     {
//                         role: "user",
//                         content: prompt,
//                     }
//                 ],
//                 model: "llama-3.3-70b-versatile",
//                 max_tokens: 1000,
//                 temperature: 0.1
//             });
//             modelUsed = "llama-3.3-70b-versatile";
//         } catch (error) {
//             console.log('⚠️ Primary model failed, trying fallback:', error.message);
            
//             // Try fallback model
//             completion = await groq.chat.completions.create({
//                 messages: [
//                     {
//                         role: "system",
//                         content: "You are a helpful AI assistant. Answer questions clearly and concisely. If you're given context, base your answer on that context."
//                     },
//                     {
//                         role: "user",
//                         content: prompt,
//                     }
//                 ],
//                 model: "llama-3.1-8b-instant",
//                 max_tokens: 1000,
//                 temperature: 0.1
//             });
//             modelUsed = "llama-3.1-8b-instant";
//         }

//         const response = completion.choices[0]?.message?.content || "";
        
//         console.log('✅ Response generated using:', modelUsed);
//         console.log('📤 Response:', response.substring(0, 100) + '...');

//         res.json({ 
//             response: response,
//             model: modelUsed,
//             timestamp: new Date().toISOString()
//         });

//     } catch (error) {
//         console.error('❌ Chat error:', error);
//         res.status(500).json({ 
//             error: 'Failed to generate response',
//             details: error.message 
//         });
//     }
// });

// // Simple text-based context endpoint (for future use)
// app.post('/context', async (req, res) => {
//     try {
//         const { text, question } = req.body;

//         if (!question) {
//             return res.status(400).json({ error: 'Question is required' });
//         }

//         console.log('📝 Context-based question:', question);
//         console.log('📄 Context length:', text ? text.length : 0);

//         const prompt = text 
//             ? `Based on the following text, please answer the question:\n\nText: ${text}\n\nQuestion: ${question}`
//             : question;

//         // Try primary model first
//         let completion;
//         let modelUsed;
        
//         try {
//             completion = await groq.chat.completions.create({
//                 messages: [
//                     {
//                         role: "system",
//                         content: "You are a helpful AI assistant. Answer questions based on the provided text. Be specific and cite relevant parts of the text when possible."
//                     },
//                     {
//                         role: "user",
//                         content: prompt,
//                     }
//                 ],
//                 model: "llama-3.3-70b-versatile",
//                 max_tokens: 1000,
//                 temperature: 0.1
//             });
//             modelUsed = "llama-3.3-70b-versatile";
//         } catch (error) {
//             console.log('⚠️ Primary model failed, trying fallback:', error.message);
            
//             completion = await groq.chat.completions.create({
//                 messages: [
//                     {
//                         role: "system",
//                         content: "You are a helpful AI assistant. Answer questions based on the provided text. Be specific and cite relevant parts of the text when possible."
//                     },
//                     {
//                         role: "user",
//                         content: prompt,
//                     }
//                 ],
//                 model: "llama-3.1-8b-instant",
//                 max_tokens: 1000,
//                 temperature: 0.1
//             });
//             modelUsed = "llama-3.1-8b-instant";
//         }

//         const response = completion.choices[0]?.message?.content || "";
        
//         console.log('✅ Context response generated using:', modelUsed);

//         res.json({ 
//             response: response,
//             model: modelUsed,
//             timestamp: new Date().toISOString()
//         });

//     } catch (error) {
//         console.error('❌ Context error:', error);
//         res.status(500).json({ 
//             error: 'Failed to process context-based question',
//             details: error.message 
//         });
//     }
// });

// Document processing endpoint (PDF, Excel, CSV)
app.post('/process_documents', authenticateToken , upload.array('documents', 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No documents provided' });
        }

        // Keep this line as it uses req.user.username from authentication
        console.log(`📄 Processing ${req.files.length} document(s) for user: ${req.user.username}`);

        // REMOVE THIS DUPLICATE LINE:
        // console.log(`📄 Processing ${req.files.length} document(s)...`);


        let extractedText = '';
        let totalChunks = 0;
        let processedFiles = [];
        // NEW: Initialize allStructuredCatalogData here
        let allStructuredCatalogData = []; // This will collect structured data from all suitable files

        // Process each file based on its type
        for (const file of req.files) {
            console.log(`📖 Processing: ${file.originalname} (${file.mimetype})`);
            
            try {
                // Change 'text' to 'fileText' to avoid confusion if `convertExcelToText` etc. return objects
                let fileText = '';
                // NEW: Initialize fileStructuredData for each file
                let fileStructuredData = [];

                if (file.mimetype === 'application/pdf') {
                    // Process PDF (No change needed here for text extraction)
                    fileText = await new Promise((resolve, reject) => {
                        let textItems = [];
                        
                        new PdfReader().parseBuffer(file.buffer, (err, item) => {
                            if (err) {
                                reject(err);
                            } else if (!item) {
                                resolve(textItems.join(' ').trim());
                            } else if (item.text) {
                                textItems.push(item.text);
                            }
                        });
                    });
                    // IMPORTANT: PDFs don't yield structured catalog data with this parser.
                    // If you need structured data from PDF, it's a much more complex task
                    // often involving advanced NLP or LLM calls on the raw PDF text.

                } else if (file.mimetype.includes('excel') || file.originalname.endsWith('.xlsx') || file.originalname.endsWith('.xls')) {
                    // Process Excel (will now return {text, structuredData})
                    const result = convertExcelToText(file.buffer); // Your modified function
                    fileText = result.text;
                    fileStructuredData = result.structuredData; // Capture structured data
                } else if (file.mimetype === 'text/csv' || file.mimetype === 'application/csv' || file.originalname.endsWith('.csv')) {
                    // Process CSV (will now return {text, structuredData})
                    const result = await convertCsvToText(file.buffer); // Your modified function
                    fileText = result.text;
                    fileStructuredData = result.structuredData; // Capture structured data
                } else {
                    throw new Error(`Unsupported file type: ${file.mimetype}`);
                }
                
                if (fileText) {
                    extractedText += `\n\n=== ${file.originalname} ===\n\n${fileText}`;
                    processedFiles.push({
                        name: file.originalname,
                        type: file.mimetype,
                        status: 'success'
                    });
                    // NEW: If structured data was found for this file, add it to the overall collection
                    if (fileStructuredData.length > 0) {
                        allStructuredCatalogData = allStructuredCatalogData.concat(fileStructuredData);
                    }
                } else {
                    console.warn(`⚠️ No content extracted from ${file.originalname}`);
                    processedFiles.push({
                        name: file.originalname,
                        type: file.mimetype,
                        status: 'empty'
                    });
                }
            } catch (fileError) {
                console.error(`❌ Error processing ${file.originalname}:`, fileError.message);
                processedFiles.push({
                    name: file.originalname,
                    type: file.mimetype,
                    status: 'error',
                    error: fileError.message
                });
                return res.status(400).json({ 
                    error: `Failed to process file: ${file.originalname}`,
                    details: fileError.message,
                    processed_files: processedFiles
                });
            }
        }

        if (!extractedText.trim()) {
            return res.status(400).json({ 
                error: 'No content could be extracted from the provided files',
                processed_files: processedFiles
            });
        }

        // Store the extracted content (text) globally
        pdfContent = extractedText.trim(); // Your existing global variable for raw text
        isProcessed = true; // Your existing global flag

        // NEW: Store the collected structured catalog data globally
        processedCatalogData = allStructuredCatalogData;
        
        totalChunks = Math.ceil(pdfContent.length / 1000); // Approximate chunks

        console.log(`✅ Document processing completed!`);
        console.log(`📝 Extracted ${pdfContent.length} characters`);
        console.log(`📊 Created ~${totalChunks} text chunks`);
        // NEW: Log the number of structured items found
        console.log(`🍽️ Extracted ${processedCatalogData.length} structured catalog items.`);

        res.json({
            message: 'Documents processed successfully',
            chunks_created: totalChunks,
            total_chars: pdfContent.length,
            ai_provider: 'Groq',
            files_processed: req.files.length,
            processed_files: processedFiles,
            supported_formats: ['PDF', 'Excel (.xlsx, .xls)', 'CSV'],
            // NEW: Include item names in the response for the frontend
            item_names: processedCatalogData.map(item => item.item_name),
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Document processing error:', error);
        res.status(500).json({
            error: 'Failed to process documents',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

app.get('/get_catalog_items', authenticateToken, (req, res) => {
    if (!isProcessed || processedCatalogData.length === 0) {
        return res.status(400).json({ error: 'No catalog data processed yet. Please upload and process documents.' });
    }
    res.json({
        items: processedCatalogData,
        item_names: processedCatalogData.map(item => item.item_name),
        timestamp: new Date().toISOString()
    });
});

const readOrders = () => {
    try {
        if (!fs.existsSync(ORDERS_FILE)) {
            fs.writeFileSync(ORDERS_FILE, '[]');
        }
        const data = fs.readFileSync(ORDERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading orders.json:', error);
        return [];
    }
};

const writeOrders = (orders) => {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf8');
};


// NEW: Endpoint to submit an order
// Inside app.post('/submit_order', authenticateToken, async (req, res) => { ... }
app.post('/submit_order', authenticateToken, async (req, res) => {
    // MODIFIED LINE: Add deliveryTime to destructuring
    const { itemName, quantity, price, deliveryDate, partOfDay, deliveryTime } = req.body;
    const { username, phone_number } = req.user;

    // MODIFIED LINE: Add deliveryTime to validation
    if (!itemName || !quantity || !price || !deliveryDate || !partOfDay || !deliveryTime) {
        return res.status(400).json({ error: 'All order details are required.' });
    }

    try {
        const orders = readOrders();
        // ... (existing date/time formatting logic) ...
        const IST_TIMEZONE = 'Asia/Kolkata'; // ADD THIS LINE

            // Get current UTC date and convert to IST zoned date
            const now = new Date();
            const istDate = toZonedTime(now, IST_TIMEZONE);

            // Format the IST zoned date into an ISO-like string with IST offset (+05:30)
            // 'yyyy-MM-dd'T'HH:mm:ss.SSSXXX' is the format pattern (XXX gives +05:30)
            const orderTimestampIST = format(istDate, "yyyy-MM-dd'T'HH:mm:ss.SSSXXX", { timeZone: IST_TIMEZONE });
        const newOrder = {
            order_id: uuidv4(),
            customer_username: username,
            customer_phone_number: phone_number,
            item_name: itemName,
            quantity: quantity,
            price_per_item: price,
            total_price: parseFloat((quantity * price).toFixed(2)),
            delivery_date: deliveryDate,
            part_of_day: partOfDay,
            delivery_time: deliveryTime, // NEW: Store deliveryTime
            order_timestamp: orderTimestampIST // Already getting this as IST
        };

        orders.push(newOrder);
        writeOrders(orders);

        console.log(`✅ Order submitted by ${username} for ${quantity} x ${itemName} at ${deliveryTime}. Order ID: ${newOrder.order_id}`);
        res.status(201).json({
            message: 'Order submitted successfully!',
            order: newOrder
        });

    } catch (error) {
        console.error('❌ Order submission error:', error);
        res.status(500).json({ error: 'Failed to submit order', details: error.message });
    }
});
// Backward compatibility endpoint for PDF processing
app.post('/process_pdf', authenticateToken ,  upload.array('pdf_docs', 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No PDF files provided' });
        }

        console.log(`📄 Processing ${req.files.length} PDF file(s) via legacy endpoint for user: ${req.user.username}`);

        console.log(`📄 Processing ${req.files.length} PDF file(s) via legacy endpoint...`);
        
        let extractedText = '';
        let totalChunks = 0;
        let processedFiles = [];

        // Process each PDF file
        for (const file of req.files) {
            console.log(`📖 Processing: ${file.originalname} (${file.mimetype})`);
            
            try {
                if (file.mimetype !== 'application/pdf') {
                    throw new Error('Only PDF files are supported in this legacy endpoint');
                }

                const text = await new Promise((resolve, reject) => {
                    let textItems = [];
                    
                    new PdfReader().parseBuffer(file.buffer, (err, item) => {
                        if (err) {
                            reject(err);
                        } else if (!item) {
                            // End of file
                            resolve(textItems.join(' ').trim());
                        } else if (item.text) {
                            textItems.push(item.text);
                        }
                    });
                });
                
                if (text) {
                    extractedText += `\n\n=== ${file.originalname} ===\n\n${text}`;
                    processedFiles.push({
                        name: file.originalname,
                        type: file.mimetype,
                        status: 'success'
                    });
                } else {
                    console.warn(`⚠️ No content extracted from ${file.originalname}`);
                    processedFiles.push({
                        name: file.originalname,
                        type: file.mimetype,
                        status: 'empty'
                    });
                }
            } catch (fileError) {
                console.error(`❌ Error processing ${file.originalname}:`, fileError.message);
                processedFiles.push({
                    name: file.originalname,
                    type: file.mimetype,
                    status: 'error',
                    error: fileError.message
                });
                return res.status(400).json({ 
                    error: `Failed to process PDF: ${file.originalname}`,
                    details: fileError.message,
                    processed_files: processedFiles
                });
            }
        }

        if (!extractedText.trim()) {
            return res.status(400).json({ 
                error: 'No content could be extracted from the provided PDF files',
                processed_files: processedFiles
            });
        }

        // Store the extracted content
        pdfContent = extractedText.trim();
        isProcessed = true;
        totalChunks = Math.ceil(pdfContent.length / 1000); // Approximate chunks

        console.log(`✅ PDF processing completed!`);
        console.log(`📝 Extracted ${pdfContent.length} characters`);
        console.log(`📊 Created ~${totalChunks} text chunks`);

        res.json({
            message: 'PDFs processed successfully (legacy endpoint)',
            chunks_created: totalChunks,
            total_chars: pdfContent.length,
            ai_provider: 'Groq',
            files_processed: req.files.length,
            processed_files: processedFiles,
            note: 'This is a legacy endpoint. Consider using /process_documents for multi-format support.',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ PDF processing error:', error);
        res.status(500).json({
            error: 'Failed to process PDF files',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Spell check endpoint - test typo correction functionality
app.post('/spell_check', async (req, res) => {
    try {
        const { text } = req.body;

        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }

        console.log('🔧 Spell check request:', text);
        
        // Apply spell checking and typo correction
        const spellCheck = correctSpelling(text);
        
        console.log('📝 Spell check result:', spellCheck);
        
        res.json({
            original_text: text,
            corrected_text: spellCheck.corrected,
            corrections_applied: spellCheck.corrections,
            has_corrections: spellCheck.hasCorrections,
            note: spellCheck.hasCorrections 
                ? 'Text contained typos that were corrected.'
                : 'No corrections needed.',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Spell check error:', error);
        res.status(500).json({
            error: 'Failed to process spell check',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Answer question based on processed documents
app.post('/answer_question',authenticateToken, async (req, res) => {
    try {
        const { user_question } = req.body;

        if (!user_question) {
            return res.status(400).json({ error: 'Question is required' });
        }

         console.log(`❓ Original question from ${req.user.username}:`, user_question);

        if (!isProcessed || !pdfContent) {
            return res.status(400).json({ 
                error: 'No document content available. Please process documents first.' 
            });
        }

        console.log('❓ Original question:', user_question);
        
        // Apply spell checking and typo correction
        const spellCheck = correctSpelling(user_question);
        const correctedQuestion = spellCheck.corrected;
        
        if (spellCheck.hasCorrections) {
            console.log('🔧 Spell corrections applied:');
            spellCheck.corrections.forEach(correction => {
                console.log(`   ${correction}`);
            });
            console.log('❓ Corrected question:', correctedQuestion);
        }
        
        console.log('📄 Using document content length:', pdfContent.length);

        // Create a comprehensive prompt for document analysis (PDF, Excel, CSV)
        const prompt = `You are a helpful assistant that answers questions based on provided document content. The content may include PDF text, Excel spreadsheets, or CSV data.

INSTRUCTIONS:
1. Answer the question accurately based ONLY on the provided context
2. If the answer is not in the context, clearly state "The answer is not available in the provided document"
3. Be concise but complete in your response
4. For spreadsheet data (Excel/CSV):
   - Analyze the data structure and relationships
   - Provide insights about trends, patterns, or specific values
   - Reference specific rows, columns, or cells when relevant
   - Calculate totals, averages, or other metrics if requested
5. For PDF content:
   - Quote relevant parts from the document when helpful
   - Maintain the original meaning and context
6. If the question is ambiguous, ask for clarification
7. If asked for data analysis, provide clear explanations of your findings

CONTEXT:
${pdfContent}

QUESTION: ${correctedQuestion}

ANSWER:`;

        // Try primary model first
        let completion;
        let modelUsed;
        
        try {
            completion = await groq.chat.completions.create({
                messages: [
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                model: "llama-3.3-70b-versatile",
                max_tokens: 2000,
                temperature: 0.8
            });
            modelUsed = "llama-3.3-70b-versatile";
        } catch (error) {
            console.log('⚠️ Primary model failed, trying fallback:', error.message);
            
            completion = await groq.chat.completions.create({
                messages: [
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                model: "llama-3.1-8b-instant",
                max_tokens: 1500,
                temperature: 0.8
            });
            modelUsed = "llama-3.1-8b-instant";
        }

        const answer = completion.choices[0]?.message?.content || "I apologize, but I couldn't generate an answer to your question.";
        
        console.log('✅ Answer generated using:', modelUsed);
        console.log('📤 Answer preview:', answer.substring(0, 150) + '...');

        const response = {
            answer: answer,
            ai_provider: 'Groq',
            model: modelUsed,
            content_length: pdfContent.length,
            timestamp: new Date().toISOString()
        };
        
        // Include spell check information if corrections were made
        if (spellCheck.hasCorrections) {
            response.spell_check = {
                original_question: user_question,
                corrected_question: correctedQuestion,
                corrections_applied: spellCheck.corrections,
                note: 'Your question contained some typos that were automatically corrected.'
            };
        }
        
        res.json(response);

    } catch (error) {
        console.error('❌ Question answering error:', error);
        res.status(500).json({
            error: 'Failed to answer question',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// API status endpoint
app.get('/status', async (req, res) => {
    try {
        // Test Groq API connectivity
        const testCompletion = await groq.chat.completions.create({
            messages: [{ role: "user", content: "Hello" }],
            model: "llama-3.1-8b-instant",
            max_tokens: 5
        });

        res.json({
            status: 'operational',
            groq: 'connected',
            models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            status: 'degraded',
            groq: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('🚨 Unhandled error:', error);
    res.status(500).json({ 
        error: 'Internal server error',
        timestamp: new Date().toISOString()
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        error: 'Endpoint not found',
        availableEndpoints: ['/health', '/chat', '/context', '/register', '/login', '/logout', '/conversational_order', '/process_documents', '/process_pdf', '/answer_question', '/spell_check', '/status'],
        timestamp: new Date().toISOString()
    });
});

// Start server
app.listen(PORT, () => {
    console.log('🚀 Docu-Mind Backend Server Started');
    console.log(`📡 Server running on http://localhost:${PORT}`);
    console.log('🤖 Using Groq API for AI responses');
    console.log('\n📚 Available endpoints:');
    console.log(`  GET  /health           - Health check`);
    console.log(`  GET  /status           - API status`);
    console.log(`  POST /chat             - General chat`);
    console.log(`  POST /context          - Context-based Q&A`);
    console.log(`  POST /register         - Register new user`);
    console.log(`  POST /login            - Login user`);
    console.log(`  POST /logout           - Logout user`);
    console.log(`  POST /process_documents - Process PDF, Excel, and CSV files`);
    console.log(`  POST /process_pdf       - Process PDF files (legacy)`);
    console.log(`  POST /answer_question  - Answer questions about processed documents`);
    console.log(`  POST /spell_check       - Test spell check and typo correction`);
    console.log(`  POST /conversational_order - Get AI-driven conversational responses (Protected)`);
    console.log('\n📄 Supported file formats: PDF, Excel (.xlsx, .xls), CSV');
    console.log('✨ Ready to process documents and answer your questions!');
});

export default app;
