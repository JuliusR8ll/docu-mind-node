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
import fetch from 'node-fetch';

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { v4 as uuidv4 } from 'uuid';

import { toZonedTime } from 'date-fns-tz';
import { format } from 'date-fns';

dotenv.config();

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

const app = express();
const PORT = process.env.PORT || 8000;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkeythatshouldbeverylongandrandom';

const USERS_FILE = path.join(__dirname, 'users.json');
const ORDERS_FILE = path.join(__dirname, 'orders.json');

let processedCatalogData = [];

const readUsers = () => {
    try {
        if (!fs.existsSync(USERS_FILE)) {
            fs.writeFileSync(USERS_FILE, '[]');
        }
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading users.json:', error);
        return [];
    }
};

const writeUsers = (users) => {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
};

function convertExcelToText(buffer) {
    try {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        let text = '';
        let structuredData = []; 

        workbook.SheetNames.forEach(sheetName => {
            const sheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(sheet);
            
            if (jsonData.length === 0) {
                text += `{"sheet":"${sheetName}","note":"empty"}
`;
            } else {
                text += `
=== Sheet: ${sheetName} ===
`;
                jsonData.forEach((row, index) => {
                    text += `Row ${index + 1}: ${JSON.stringify(row)}
`;
                    
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

        return { text, structuredData }; 
    } catch (err) {
        throw new Error('Failed to read Excel file: ' + err.message);
    }
}

function convertCsvToText(buffer) {
    return new Promise((resolve, reject) => {
        let text = '';
        let structuredData = []; 
        let rowCount = 0;
        
        try {
            const tempFile = path.join(os.tmpdir(), `csv_${Date.now()}.csv`);
            fs.writeFileSync(tempFile, buffer);
            
            fs.createReadStream(tempFile, { encoding: 'utf8' })
                .pipe(csv())
                .on('data', (row) => {
                    rowCount++;
                    text += `Row ${rowCount}: ${JSON.stringify(row)}
`;

                    const itemName = row['item_name'];
                    const price = parseFloat(row['price']);
                    const quantity = parseInt(row['available_quantity']);

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
                    resolve({ text, structuredData }); 
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

function createCommonWords() {
    return [
        'what', 'where', 'when', 'why', 'who', 'how', 'which', 'whose',
        'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
        'do', 'does', 'did', 'will', 'would', 'could', 'should', 'can', 'may', 'might',
        'show', 'tell', 'find', 'get', 'give', 'take', 'make', 'come', 'go', 'see',
        'know', 'think', 'feel', 'want', 'need', 'use', 'work', 'try', 'ask', 'help',
        'look', 'seem', 'turn', 'start', 'call', 'keep', 'become', 'leave', 'put',
        'mean', 'say', 'move', 'play', 'run', 'live', 'believe', 'hold', 'bring',
        'happen', 'write', 'sit', 'stand', 'lose', 'pay', 'meet', 'include', 'continue',
        'document', 'file', 'text', 'data', 'information', 'content', 'page', 'section',
        'chapter', 'paragraph', 'line', 'word', 'sentence', 'title', 'heading',
        'summary', 'analysis', 'report', 'table', 'chart', 'graph', 'figure',
        'number', 'amount', 'total', 'sum', 'average', 'count', 'percentage',
        'calculate', 'compute', 'analyze', 'examine', 'review', 'check', 'compare',
        'explain', 'describe', 'summarize', 'outline', 'detail', 'discuss',
        'main', 'important', 'key', 'major', 'minor', 'significant', 'relevant',
        'specific', 'general', 'particular', 'certain', 'different', 'similar',
        'same', 'new', 'old', 'first', 'last', 'next', 'previous', 'current',
        'final', 'initial', 'original', 'complete', 'full', 'partial', 'total',
        'in', 'on', 'at', 'by', 'for', 'with', 'from', 'to', 'of', 'about',
        'through', 'during', 'before', 'after', 'above', 'below', 'up', 'down',
        'over', 'under', 'between', 'among', 'and', 'or', 'but', 'so', 'if',
        'because', 'since', 'while', 'although', 'however', 'therefore', 'thus',
        'the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'your',
        'his', 'her', 'its', 'our', 'their', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
        'time', 'year', 'day', 'week', 'month', 'hour', 'minute', 'second',
        'person', 'people', 'man', 'woman', 'child', 'group', 'company', 'business',
        'place', 'area', 'country', 'state', 'city', 'home', 'house', 'office',
        'problem', 'question', 'answer', 'issue', 'solution', 'result', 'effect',
        'cause', 'reason', 'purpose', 'goal', 'objective', 'plan', 'strategy',
        'method', 'approach', 'way', 'process', 'system', 'program', 'project',
        'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
        'hundred', 'thousand', 'million', 'billion', 'many', 'few', 'several', 'some',
        'all', 'most', 'more', 'less', 'much', 'little', 'enough', 'too'
    ];
}

function createTypoPatterns() {
    return {
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
    
    for (const [typo, correction] of Object.entries(typoPatterns)) {
        const regex = new RegExp(`\b${typo}\b`, 'gi');
        corrected = corrected.replace(regex, correction);
    }
    
    return corrected;
}

function findClosestWord(word, dictionary, threshold = 3) {
    if (!word || word.length < 2) return null;
    
    let bestMatch = null;
    let bestDistance = threshold;
    
    for (const dictWord of dictionary) {
        if (dictWord === word) return word;
        
        const distance = levenshtein.get(word.toLowerCase(), dictWord.toLowerCase());
        
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
    
    let corrected = correctCommonTypos(text);
    let corrections = [];
    
    if (corrected !== text.toLowerCase()) {
        corrections.push(`Applied common typo fixes: "${text}" -> "${corrected}"`);
    }
    
    try {
        const doc = nlp(corrected);
        const words = doc.terms().out('array');
        const commonWords = createCommonWords();
        
        let hasChanges = false;
        const correctedWords = words.map(word => {
            if (word.length < 3) return word;
            
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

const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024, 
        files: 10 
    },
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 
            'application/vnd.ms-excel', 
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


const loadCatalog = async () => {
    try {
        const csvFilePath = path.join(__dirname, 'sample_catalog.csv');
        if (fs.existsSync(csvFilePath)) {
            const buffer = fs.readFileSync(csvFilePath);
            const { structuredData } = await convertCsvToText(buffer);
            processedCatalogData = structuredData;
            console.log('✅ Catalog loaded from sample_catalog.csv');
            console.log(`🍽️  ${processedCatalogData.length} catalog items loaded.`);
        } else {
            console.warn('⚠️ sample_catalog.csv not found. Catalog will be empty.');
        }
    } catch (error) {
        console.error('❌ Error loading catalog:', error);
    }
};

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; 

    if (token == null) {
        return res.status(401).json({ error: 'Authentication token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.error('JWT verification failed:', err.message);
            
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user; 
        next(); 
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
        const hashedPassword = await bcrypt.hash(password, 10); 
        const newUser = {
            id: Date.now().toString(), 
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

        const token = jwt.sign(
            { id: user.id, username: user.username, phone_number: user.phone_number },
            JWT_SECRET,
            { expiresIn: '1h' } 
        );

        console.log(`✅ User logged in: ${username}`);
        res.json({
            message: 'Logged in successfully!',
            token,
            user: { 
                username: user.username,
                phone_number: user.phone_number
            }
        });

    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({ error: 'Failed to log in', details: error.message });
    }
});

app.post('/logout', authenticateToken, (req, res) => {
    console.log(`✅ User logged out (token validated): ${req.user.username}`);
    res.json({ message: 'Logged out successfully!' });
});

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


async function answerQuestionInternally(question, user) {
    const response = await fetch(`http://localhost:${PORT}/answer_question`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${jwt.sign({ id: user.id, username: user.username }, JWT_SECRET)}`
        },
        body: JSON.stringify({ user_question: question })
    });
    return response.json();
}

app.post('/conversational_order', authenticateToken, async (req, res) => {
    const { chatHistory, currentStep, availableItems, userInput, cart } = req.body;

    if (!chatHistory || !currentStep || !userInput) {
        return res.status(400).json({ error: 'Chat history, current step, and user input are required.' });
    }

    // Check if the user is asking a question about the restaurant
    const isRestaurantQuestion = /restaurant|location|hours|contact|about|chef|story|reservations|policies/i.test(userInput);

    if (isRestaurantQuestion) {
        try {
            const answerResponse = await answerQuestionInternally(userInput, req.user);
            return res.json({ response: answerResponse.answer });
        } catch (error) {
            console.error('Error answering restaurant question:', error);
            return res.status(500).json({ error: 'Failed to answer question' });
        }
    }

    let systemPrompt;
    let model = "llama-3.1-8b-instant";
    let responseFormat = null; 

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
               - If no match is found, politely tell the user you couldn't find that item and gently guide them by mentioning one or two other items from the list (e.g., "Hmm, I don't see 'Fren Frie' on our menu. We do have 'French Fries' and 'Classic Burger' though. Did you mean one of those?" Be creative and vary your responses.
            
            Example of a good match response: {"match": "Classic Burger", "response": "Classic Burger, an excellent choice! How many would you like to order?"}
            Example of a done response: {"match": "done", "response": "Perfect! Let's proceed with your delivery details."}
            Example of a no-match response: {"match": "None", "response": "Sorry, I couldn't find 'sushi' on our menu today. Perhaps you'd like our popular Margherita Pizza instead?"}`
            break;

        case 'modify_quantity':
            model = "llama-3.3-70b-versatile";
            responseFormat = { type: "json_object" };
            
            // This prompt is specifically for extracting the item and new quantity
            systemPrompt = `You are an AI assistant analyzing a user's request to change an item's quantity in their shopping cart.
            The user's current cart contains these items: [${cart.map(item => `"${item.itemName}"`).join(', ')}].
            The user's request is: "${userInput}".

            Your task is to identify which item from the cart the user wants to modify and what the new quantity is.

            You MUST respond in a valid JSON format with two keys:
            1. "item": A string containing the exact item name from the cart that the user wants to change. If you cannot determine the item, this MUST be the string "None".
            2. "quantity": A number representing the new quantity. If you cannot determine the quantity, this MUST be 0.
            
            Example user input "make the burger 3": {"item": "Classic Burger", "quantity": 3}
            Example user input "i need 2 fries": {"item": "French Fries", "quantity": 2}
            Example user input "change it to 4": {"item": "None", "quantity": 4} (Ambiguous item)
            Example user input "just the burger": {"item": "Classic Burger", "quantity": 0} (Ambiguous quantity)`;
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
            ...chatHistory, 
            { role: "user", content: userInput } 
        ];

        const completion = await groq.chat.completions.create({
            messages: messages,
            model: model, 
            max_tokens: 250, 
            temperature: 0.7,
            response_format: responseFormat, 
            stream: false
        });

        let aiResponse = completion.choices[0]?.message?.content;

        if (currentStep === 'item_selection' || currentStep === 'modify_quantity') {
     try {
         const structuredResponse = JSON.parse(aiResponse);
         res.json(structuredResponse);
     } catch (jsonError) {
         console.error("Failed to parse JSON response from LLM:", aiResponse);
         res.status(500).json({
             error: "The AI response was not in the expected format. Please try again."
         });
     }
 } else {
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


app.post('/process_documents', authenticateToken , upload.array('documents', 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No documents provided' });
        }

        console.log(`📄 Processing ${req.files.length} document(s) for user: ${req.user.username}`);


        let extractedText = '';
        let totalChunks = 0;
        let processedFiles = [];
        let allStructuredCatalogData = []; 

        for (const file of req.files) {
            console.log(`📖 Processing: ${file.originalname} (${file.mimetype})`);
            
            try {
                let fileText = '';
                let fileStructuredData = [];

                if (file.mimetype === 'application/pdf') {
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

                } else if (file.mimetype.includes('excel') || file.originalname.endsWith('.xlsx') || file.originalname.endsWith('.xls')) {
                    const result = convertExcelToText(file.buffer); 
                    fileText = result.text;
                    fileStructuredData = result.structuredData;
                } else if (file.mimetype === 'text/csv' || file.mimetype === 'application/csv' || file.originalname.endsWith('.csv')) {
                    const result = await convertCsvToText(file.buffer); 
                    fileText = result.text;
                    fileStructuredData = result.structuredData;
                } else {
                    throw new Error(`Unsupported file type: ${file.mimetype}`);
                }
                
                if (fileText) {
                    extractedText += `

=== ${file.originalname} ===

${fileText}`;
                    processedFiles.push({
                        name: file.originalname,
                        type: file.mimetype,
                        status: 'success'
                    });
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

        pdfContent = extractedText.trim(); 
        isProcessed = true; 

        processedCatalogData = allStructuredCatalogData;
        
        totalChunks = Math.ceil(pdfContent.length / 1000); 

        console.log(`✅ Document processing completed!`);
        console.log(`📝 Extracted ${pdfContent.length} characters`);
        console.log(`📊 Created ~${totalChunks} text chunks`);
        console.log(`🍽️ Extracted ${processedCatalogData.length} structured catalog items.`);

        res.json({
            message: 'Documents processed successfully',
            chunks_created: totalChunks,
            total_chars: pdfContent.length,
            ai_provider: 'Groq',
            files_processed: req.files.length,
            processed_files: processedFiles,
            supported_formats: ['PDF', 'Excel (.xlsx, .xls)', 'CSV'],
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

app.get('/api/catalog', authenticateToken, (req, res) => {
    res.json({
        items: processedCatalogData,
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

const writeCatalogToCsv = () => {
    const ws = XLSX.utils.json_to_sheet(processedCatalogData);
    const csv = XLSX.utils.sheet_to_csv(ws);
    fs.writeFileSync(path.join(__dirname, 'sample_catalog.csv'), csv);
};


app.post('/submit_order', authenticateToken, async (req, res) => {
    // MODIFIED: The request body will now contain a 'cart' array and delivery details
    const { cart, deliveryDate, partOfDay, deliveryTime } = req.body;
    const { username, phone_number } = req.user;

    // MODIFIED: Updated validation for cart and delivery details
    if (!cart || !Array.isArray(cart) || cart.length === 0 || !deliveryDate || !partOfDay || !deliveryTime) {
        return res.status(400).json({ error: 'A non-empty cart and all delivery details are required.' });
    }

    try {
        // --- NEW: Transaction-like validation block ---
        // First, check if all items are in stock before making any changes.
        for (const cartItem of cart) {
            const catalogItem = processedCatalogData.find(item => item.item_name === cartItem.itemName); // Note: frontend sends 'itemName'

            if (!catalogItem) {
                return res.status(404).json({ error: `Item not found in catalog: ${cartItem.itemName}` });
            }
            if (catalogItem.available_quantity < cartItem.quantity) {
                return res.status(400).json({ error: `Not enough stock for ${cartItem.itemName}. Available: ${catalogItem.available_quantity}, Requested: ${cartItem.quantity}` });
            }
        }
        // --- End of validation block ---


        // --- NEW: Update quantities in memory ---
        // If all checks pass, now we can safely update the quantities.
        cart.forEach(cartItem => {
            const catalogItem = processedCatalogData.find(item => item.item_name === cartItem.itemName);
            if (catalogItem) {
                catalogItem.available_quantity -= cartItem.quantity;
            }
        });

        // Write the updated catalog back to the CSV file to persist stock changes
        writeCatalogToCsv();

        const orders = readOrders();
        const IST_TIMEZONE = 'Asia/Kolkata';
        const now = new Date();
        const istDate = toZonedTime(now, IST_TIMEZONE);
        const orderTimestampIST = format(istDate, "yyyy-MM-dd'T'HH:mm:ss.SSSXXX", { timeZone: IST_TIMEZONE });

        // MODIFIED: Calculate total price from the cart items on the backend for security
        const totalPrice = cart.reduce((total, item) => total + (item.price * item.quantity), 0);

        // MODIFIED: Create a single order object containing the cart array
        const newOrder = {
            order_id: uuidv4(),
            customer_username: username,
            customer_phone_number: phone_number,
            items: cart.map(item => ({ // Sanitize the cart items for storage
                item_name: item.itemName,
                quantity: item.quantity,
                price_per_item: item.price
            })),
            total_price: parseFloat(totalPrice.toFixed(2)),
            delivery_date: deliveryDate,
            part_of_day: partOfDay,
            delivery_time: deliveryTime,
            order_timestamp: orderTimestampIST
        };

        orders.push(newOrder);
        writeOrders(orders);

        console.log(`✅ Order submitted by ${username} with ${cart.length} item(s). Order ID: ${newOrder.order_id}`);
        res.status(201).json({
            message: 'Order submitted successfully!',
            order: newOrder
        });

    } catch (error) {
        console.error('❌ Order submission error:', error);
        res.status(500).json({ error: 'Failed to submit order', details: error.message });
    }
});

app.post('/process_pdf', authenticateToken ,  upload.array('pdf_docs', 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No PDF files provided' });
        }

        console.log(`📄 Processing ${req.files.length} PDF file(s) via legacy endpoint for user: ${req.user.username}`);

        
        let extractedText = '';
        let totalChunks = 0;
        let processedFiles = [];

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
                            resolve(textItems.join(' ').trim());
                        } else if (item.text) {
                            textItems.push(item.text);
                        }
                    });
                });
                
                if (text) {
                    extractedText += `

=== ${file.originalname} ===

${text}`;
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

        pdfContent = extractedText.trim();
        isProcessed = true;
        totalChunks = Math.ceil(pdfContent.length / 1000); 

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

app.post('/spell_check', async (req, res) => {
    try {
        const { text } = req.body;

        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }

        console.log('🔧 Spell check request:', text);
        
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

let restaurantInfoContent = '';

const loadRestaurantInfo = async () => {
    try {
        const pdfFilePath = path.join(__dirname, '_Restaurant_.pdf');
        if (fs.existsSync(pdfFilePath)) {
            const buffer = fs.readFileSync(pdfFilePath);
            restaurantInfoContent = await new Promise((resolve, reject) => {
                let textItems = [];
                new PdfReader().parseBuffer(buffer, (err, item) => {
                    if (err) {
                        reject(err);
                    } else if (!item) {
                        resolve(textItems.join(' ').trim());
                    } else if (item.text) {
                        textItems.push(item.text);
                    }
                });
            });
            console.log('✅ Restaurant info loaded from restaurant_info.pdf');
        } else {
            console.warn('⚠️ restaurant_info.pdf not found. Restaurant info will be empty.');
        }
    } catch (error) {
        console.error('❌ Error loading restaurant info:', error);
    }
};
app.post('/answer_question', authenticateToken, async (req, res) => {
    try {
        const { user_question } = req.body;

        if (!user_question) {
            return res.status(400).json({ error: 'Question is required' });
        }

        console.log(`❓ Original question from ${req.user.username}:`, user_question);

        const spellCheck = correctSpelling(user_question);
        const correctedQuestion = spellCheck.corrected;

        if (spellCheck.hasCorrections) {
            console.log('🔧 Spell corrections applied:');
            spellCheck.corrections.forEach(correction => {
                console.log(`   ${correction}`);
            });
            console.log('❓ Corrected question:', correctedQuestion);
        }

        // Determine context based on question
        const isRestaurantQuestion = /restaurant|location|hours|contact|about/i.test(correctedQuestion);
        
        let context = '';
        if (isRestaurantQuestion) {
            context = restaurantInfoContent;
        } else {
            context = pdfContent;
        }

        if (!context) {
            return res.status(400).json({
                error: 'No relevant document content available. Please process documents first.'
            });
        }

        console.log('📄 Using document content length:', context.length);

        const prompt = `You are a helpful assistant that answers questions based on provided document content.

INSTRUCTIONS:
1. Answer the question accurately based ONLY on the provided context.
2. If the answer is not in the context, clearly state "The answer is not available in the provided document."
3. Be concise but complete in your response.

CONTEXT:
${context}

QUESTION: ${correctedQuestion}

ANSWER:`;

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
            content_length: context.length,
            timestamp: new Date().toISOString()
        };

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

app.get('/status', async (req, res) => {
    try {
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

app.use((error, req, res, next) => {
    console.error('🚨 Unhandled error:', error);
    res.status(500).json({
        error: 'Internal server error',
        timestamp: new Date().toISOString()
    });
});

app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        availableEndpoints: ['/health', '/api/catalog', '/register', '/login', '/logout', '/submit_order'],
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, async () => {
    await loadCatalog();
    await loadRestaurantInfo();
    console.log(`🚀 Docu-Mind Backend Server Started on http://localhost:${PORT}`);
});

export default app;