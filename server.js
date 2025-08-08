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

dotenv.config();

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

const app = express();
const PORT = process.env.PORT || 8000;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// File conversion functions
function convertExcelToText(buffer) {
    try {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        let text = '';

        workbook.SheetNames.forEach(sheetName => {
            const sheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(sheet);
            if (jsonData.length === 0) {
                text += `{"sheet":"${sheetName}","note":"empty"}\n`;
            } else {
                text += `\n=== Sheet: ${sheetName} ===\n`;
                jsonData.forEach((row, index) => {
                    text += `Row ${index + 1}: ${JSON.stringify(row)}\n`;
                });
            }
        });

        return text;
    } catch (err) {
        throw new Error('Failed to read Excel file: ' + err.message);
    }
}

function convertCsvToText(buffer) {
    return new Promise((resolve, reject) => {
        let text = '';
        let rowCount = 0;
        
        try {
            // Create a temporary file
            const tempFile = path.join(os.tmpdir(), `csv_${Date.now()}.csv`);
            fs.writeFileSync(tempFile, buffer);
            
            fs.createReadStream(tempFile, { encoding: 'utf8' })
                .pipe(csv())
                .on('data', (row) => {
                    rowCount++;
                    text += `Row ${rowCount}: ${JSON.stringify(row)}\n`;
                })
                .on('end', () => {
                    // Clean up temp file
                    fs.unlinkSync(tempFile);
                    resolve(text);
                })
                .on('error', (err) => {
                    // Clean up temp file
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

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
app.post('/process_documents', upload.array('documents', 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No documents provided' });
        }

        console.log(`📄 Processing ${req.files.length} document(s)...`);
        
        let extractedText = '';
        let totalChunks = 0;
        let processedFiles = [];

        // Process each file based on its type
        for (const file of req.files) {
            console.log(`📖 Processing: ${file.originalname} (${file.mimetype})`);
            
            try {
                let text = '';
                
                if (file.mimetype === 'application/pdf') {
                    // Process PDF
                    text = await new Promise((resolve, reject) => {
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
                } else if (file.mimetype.includes('excel') || file.originalname.endsWith('.xlsx') || file.originalname.endsWith('.xls')) {
                    // Process Excel
                    text = convertExcelToText(file.buffer);
                } else if (file.mimetype === 'text/csv' || file.mimetype === 'application/csv' || file.originalname.endsWith('.csv')) {
                    // Process CSV
                    text = await convertCsvToText(file.buffer);
                } else {
                    throw new Error(`Unsupported file type: ${file.mimetype}`);
                }
                
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

        // Store the extracted content
        pdfContent = extractedText.trim();
        isProcessed = true;
        totalChunks = Math.ceil(pdfContent.length / 1000); // Approximate chunks

        console.log(`✅ Document processing completed!`);
        console.log(`📝 Extracted ${pdfContent.length} characters`);
        console.log(`📊 Created ~${totalChunks} text chunks`);

        res.json({
            message: 'Documents processed successfully',
            chunks_created: totalChunks,
            total_chars: pdfContent.length,
            ai_provider: 'Groq',
            files_processed: req.files.length,
            processed_files: processedFiles,
            supported_formats: ['PDF', 'Excel (.xlsx, .xls)', 'CSV'],
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

// Backward compatibility endpoint for PDF processing
app.post('/process_pdf', upload.array('pdf_docs', 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No PDF files provided' });
        }

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
app.post('/answer_question', async (req, res) => {
    try {
        const { user_question } = req.body;

        if (!user_question) {
            return res.status(400).json({ error: 'Question is required' });
        }

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
        availableEndpoints: ['/health', '/chat', '/context', '/process_documents', '/process_pdf', '/answer_question', '/spell_check', '/status'],
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
    console.log(`  POST /process_documents - Process PDF, Excel, and CSV files`);
    console.log(`  POST /process_pdf       - Process PDF files (legacy)`);
    console.log(`  POST /answer_question  - Answer questions about processed documents`);
    console.log(`  POST /spell_check       - Test spell check and typo correction`);
    console.log('\n📄 Supported file formats: PDF, Excel (.xlsx, .xls), CSV');
    console.log('✨ Ready to process documents and answer your questions!');
});

export default app;
