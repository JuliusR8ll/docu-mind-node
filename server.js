import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Groq from 'groq-sdk';
import multer from 'multer';
import { PdfReader } from 'pdfreader';

dotenv.config();

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

const app = express();
const PORT = process.env.PORT || 8000;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { 
        fileSize: 50 * 1024 * 1024, // 50MB limit
        files: 10 // Maximum 10 files
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'), false);
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
        features: ['PDF Processing', 'Question Answering', 'Document Analysis'],
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

// PDF processing endpoint
app.post('/process_pdf', upload.array('pdf_docs', 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No PDF files provided' });
        }

        console.log(`📄 Processing ${req.files.length} PDF file(s)...`);
        
        let extractedText = '';
        let totalChunks = 0;

        // Process each PDF file
        for (const file of req.files) {
            console.log(`📖 Extracting text from: ${file.originalname}`);
            
            try {
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
                } else {
                    console.warn(`⚠️ No text extracted from ${file.originalname}`);
                }
            } catch (pdfError) {
                console.error(`❌ Error processing ${file.originalname}:`, pdfError.message);
                return res.status(400).json({ 
                    error: `Failed to process PDF: ${file.originalname}`,
                    details: pdfError.message 
                });
            }
        }

        if (!extractedText.trim()) {
            return res.status(400).json({ 
                error: 'No text could be extracted from the provided PDF files' 
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
            message: 'PDFs processed successfully',
            chunks_created: totalChunks,
            total_chars: pdfContent.length,
            ai_provider: 'Groq',
            files_processed: req.files.length,
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

// Answer question based on processed PDFs
app.post('/answer_question', async (req, res) => {
    try {
        const { user_question } = req.body;

        if (!user_question) {
            return res.status(400).json({ error: 'Question is required' });
        }

        if (!isProcessed || !pdfContent) {
            return res.status(400).json({ 
                error: 'No PDF content available. Please process PDF files first.' 
            });
        }

        console.log('❓ Question:', user_question);
        console.log('📄 Using PDF content length:', pdfContent.length);

        // Create a clean, direct prompt for better PDF content analysis
        const prompt = `You are a helpful assistant that answers questions based on provided document content.

INSTRUCTIONS:
1. Answer the question accurately based ONLY on the provided context
2. If the answer is not in the context, clearly state "The answer is not available in the provided document"
3. Be concise but complete in your response
4. Quote relevant parts from the document when helpful
5. If the question is ambiguous, ask for clarification

CONTEXT:
${pdfContent}

QUESTION: ${user_question}

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

        res.json({
            answer: answer,
            ai_provider: 'Groq',
            model: modelUsed,
            content_length: pdfContent.length,
            timestamp: new Date().toISOString()
        });

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
        availableEndpoints: ['/health', '/chat', '/context', '/process_pdf', '/answer_question', '/status'],
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
    console.log(`  POST /process_pdf      - Process PDF files`);
    console.log(`  POST /answer_question  - Answer questions about processed PDFs`);
    console.log('\n✨ Ready to process PDFs and answer your questions!');
});

export default app;
