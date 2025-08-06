import express from 'express';
import multer from 'multer';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

// Initialize Google AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Middleware
app.use(cors());
app.use(express.json());

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// In-memory storage for processed documents
let documentText = '';

// Text splitting function
function splitTextIntoChunks(text, chunkSize = 10000, chunkOverlap = 1000) {
  const chunks = [];
  let start = 0;
  
  while (start < text.length) {
    let end = start + chunkSize;
    
    if (end < text.length) {
      const breakPoints = ['\n\n', '\n', '. ', ', ', ' '];
      let bestBreak = end;
      
      for (const breakPoint of breakPoints) {
        const breakIndex = text.lastIndexOf(breakPoint, end);
        if (breakIndex > start) {
          bestBreak = breakIndex + breakPoint.length;
          break;
        }
      }
      end = bestBreak;
    }
    
    chunks.push(text.slice(start, end).trim());
    start = end - chunkOverlap;
    
    if (start >= text.length) break;
  }
  
  return chunks.filter(chunk => chunk.length > 0);
}

// API Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Process PDF endpoint
app.post('/process_pdf', upload.array('pdf_docs'), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No PDF files uploaded' });
    }

    console.log(`Processing ${req.files.length} PDF file(s)...`);
    
    let allText = '';
    
    // Import pdf2json
    const PDFParser = (await import('pdf2json')).default;
    
    // Extract text from all PDF files
    for (const file of req.files) {
      try {
        const text = await new Promise((resolve, reject) => {
          const pdfParser = new PDFParser();
          
          pdfParser.on('pdfParser_dataError', errData => {
            reject(new Error(errData.parserError));
          });
          
          pdfParser.on('pdfParser_dataReady', pdfData => {
            let text = '';
            if (pdfData.Pages) {
              for (const page of pdfData.Pages) {
                if (page.Texts) {
                  for (const textItem of page.Texts) {
                    for (const textRun of textItem.R) {
                      text += decodeURIComponent(textRun.T) + ' ';
                    }
                  }
                }
                text += '\n';
              }
            }
            resolve(text);
          });
          
          pdfParser.parseBuffer(file.buffer);
        });
        
        allText += text + '\n\n';
        console.log(`Extracted text from ${file.originalname}`);
      } catch (error) {
        console.error(`Error processing ${file.originalname}:`, error);
        return res.status(400).json({ 
          error: `Failed to process ${file.originalname}: ${error.message}` 
        });
      }
    }

    if (!allText.trim()) {
      return res.status(400).json({ 
        error: 'No text could be extracted from the PDF files' 
      });
    }

    // Store the text (simple approach without embeddings)
    documentText = allText;
    const chunks = splitTextIntoChunks(allText);
    
    console.log('PDF processing completed successfully');
    res.json({ 
      status: 'PDF processing completed',
      chunks_created: chunks.length 
    });

  } catch (error) {
    console.error('Error processing PDF:', error);
    res.status(500).json({ 
      error: `PDF processing failed: ${error.message}` 
    });
  }
});

// Answer question endpoint (simplified without embeddings)
app.post('/answer_question', async (req, res) => {
  try {
    const { user_question } = req.body;
    
    if (!user_question) {
      return res.status(400).json({ error: 'No question provided' });
    }

    if (!documentText) {
      return res.status(400).json({ 
        error: 'No documents have been processed yet. Please upload and process PDF files first.' 
      });
    }

    console.log(`Answering question: "${user_question}"`);

    // Use the entire document as context (simple approach)
    const prompt = `
Answer the question as detailed as possible from the provided context, make sure to provide all the details, if the answer is not in provided context just say, "answer is not available in the context", don't provide the wrong answer

Context:
${documentText.substring(0, 8000)} 

Question: ${user_question}

Answer:`;

    // Generate response using Google AI
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1000,
      },
    });

    const answer = result.response.text();
    console.log('Question answered successfully');

    res.json({ answer });

  } catch (error) {
    console.error('Error answering question:', error);
    res.status(500).json({ 
      error: `Failed to answer question: ${error.message}` 
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    }
  }
  res.status(500).json({ error: error.message });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  
  if (!process.env.GOOGLE_API_KEY) {
    console.warn('Warning: GOOGLE_API_KEY environment variable not set!');
  }
});

export default app;
