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
let processedChunks = [];

// Improved text cleaning function
function cleanExtractedText(text) {
  if (!text) return '';
  
  return text
    // Fix common PDF encoding issues
    .replace(/\u00A0/g, ' ') // Non-breaking space
    .replace(/\u2019/g, "'") // Smart quote
    .replace(/\u201C/g, '"') // Smart quote
    .replace(/\u201D/g, '"') // Smart quote
    .replace(/\u2013/g, '-') // En dash
    .replace(/\u2014/g, '--') // Em dash
    // Remove excessive whitespace
    .replace(/\s+/g, ' ')
    // Remove page numbers and headers/footers (simple heuristic)
    .replace(/^\s*\d+\s*$/gm, '')
    // Remove very short lines that might be artifacts
    .split('\n')
    .filter(line => line.trim().length > 3)
    .join('\n')
    .trim();
}

// Improved text splitting function with better chunking
function splitTextIntoChunks(text, chunkSize = 8000, chunkOverlap = 500) {
  const chunks = [];
  let start = 0;
  
  // First, split by major sections (double newlines)
  const sections = text.split(/\n\s*\n/);
  let currentChunk = '';
  
  for (const section of sections) {
    const sectionText = section.trim();
    if (!sectionText) continue;
    
    // If adding this section would exceed chunk size, save current chunk
    if (currentChunk.length + sectionText.length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      
      // Start new chunk with overlap
      const overlapText = currentChunk.slice(-chunkOverlap);
      currentChunk = overlapText + '\n\n' + sectionText;
    } else {
      if (currentChunk) currentChunk += '\n\n';
      currentChunk += sectionText;
    }
  }
  
  // Add the last chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks.filter(chunk => chunk.length > 100); // Filter out very small chunks
}

// Improved search function that finds the most relevant chunks
function findRelevantChunks(chunks, query, topK = 3) {
  const queryWords = query.toLowerCase()
    .split(/\s+/)
    .filter(word => word.length > 2)
    .filter(word => !['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'].includes(word));
  
  const scoredChunks = chunks.map(chunk => {
    const chunkLower = chunk.toLowerCase();
    let score = 0;
    
    for (const word of queryWords) {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      const matches = chunkLower.match(regex);
      if (matches) {
        score += matches.length;
      }
    }
    
    return { chunk, score };
  });
  
  return scoredChunks
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(item => item.chunk);
}

// API Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Process PDF endpoint with improved text extraction
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
        console.log(`Processing ${file.originalname}...`);
        
        const text = await new Promise((resolve, reject) => {
          const pdfParser = new PDFParser();
          
          pdfParser.on('pdfParser_dataError', errData => {
            reject(new Error(`PDF parsing error: ${errData.parserError}`));
          });
          
          pdfParser.on('pdfParser_dataReady', pdfData => {
            let extractedText = '';
            
            if (pdfData && pdfData.Pages && Array.isArray(pdfData.Pages)) {
              for (const page of pdfData.Pages) {
                let pageText = '';
                
                if (page.Texts && Array.isArray(page.Texts)) {
                  // Sort text items by position for better reading order
                  const sortedTexts = page.Texts.sort((a, b) => {
                    if (Math.abs(a.y - b.y) < 0.5) {
                      return a.x - b.x; // Same line, sort by x
                    }
                    return a.y - b.y; // Different lines, sort by y
                  });
                  
                  for (const textItem of sortedTexts) {
                    if (textItem.R && Array.isArray(textItem.R)) {
                      for (const textRun of textItem.R) {
                        if (textRun.T) {
                          try {
                            pageText += decodeURIComponent(textRun.T) + ' ';
                          } catch (decodeError) {
                            pageText += textRun.T + ' '; // Fallback if decoding fails
                          }
                        }
                      }
                    }
                  }
                }
                
                if (pageText.trim()) {
                  extractedText += pageText + '\n\n';
                }
              }
            }
            
            if (!extractedText.trim()) {
              reject(new Error('No readable text found in PDF'));
            } else {
              resolve(extractedText);
            }
          });
          
          pdfParser.parseBuffer(file.buffer);
        });
        
        const cleanText = cleanExtractedText(text);
        if (cleanText.length < 50) {
          console.warn(`Warning: Very little text extracted from ${file.originalname}`);
        }
        
        allText += cleanText + '\n\n';
        console.log(`✅ Extracted ${cleanText.length} characters from ${file.originalname}`);
        
      } catch (error) {
        console.error(`Error processing ${file.originalname}:`, error);
        return res.status(400).json({ 
          error: `Failed to process ${file.originalname}: ${error.message}` 
        });
      }
    }

    if (!allText.trim()) {
      return res.status(400).json({ 
        error: 'No readable text could be extracted from the PDF files. The PDFs might be image-based or corrupted.' 
      });
    }

    // Clean and store the text
    const finalText = cleanExtractedText(allText);
    documentText = finalText;
    processedChunks = splitTextIntoChunks(finalText);
    
    console.log(`✅ PDF processing completed successfully`);
    console.log(`📄 Total text length: ${finalText.length} characters`);
    console.log(`📦 Created ${processedChunks.length} chunks`);
    
    res.json({ 
      status: 'PDF processing completed',
      chunks_created: processedChunks.length,
      total_chars: finalText.length,
      sample_text: finalText.substring(0, 200) + '...'
    });

  } catch (error) {
    console.error('Error processing PDF:', error);
    res.status(500).json({ 
      error: `PDF processing failed: ${error.message}` 
    });
  }
});

// Enhanced answer question endpoint
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

    console.log(`❓ Answering question: "${user_question}"`);

    // Find the most relevant chunks for the question
    const relevantChunks = findRelevantChunks(processedChunks, user_question, 3);
    
    if (relevantChunks.length === 0) {
      return res.json({
        answer: "I couldn't find relevant information in the document to answer your question. Please try rephrasing your question or asking about different topics that might be covered in the document."
      });
    }

    const context = relevantChunks.join('\n\n---\n\n');
    console.log(`📄 Using ${relevantChunks.length} relevant chunks (${context.length} characters)`);

    try {
      // Enhanced prompt for better responses
      const prompt = `You are a helpful assistant that answers questions based on provided document content. 

INSTRUCTIONS:
1. Answer the question accurately based ONLY on the provided context
2. If the answer is not in the context, clearly state "The answer is not available in the provided document"
3. Be concise but complete in your response
4. Quote relevant parts from the document when helpful
5. If the question is ambiguous, ask for clarification

CONTEXT:
${context}

QUESTION: ${user_question}

ANSWER:`;

      const model = genAI.getGenerativeModel({ 
        model: 'gemini-2.5-pro',
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 800,
        }
      });
      
      const result = await model.generateContent(prompt);
      const answer = result.response.text();
      
      // Validate that the response is not just raw text
      if (answer.length > context.length * 0.8) {
        console.warn('⚠️ Response seems to be mostly raw text, filtering...');
        // If response is too similar to context, provide a more controlled response
        const filteredAnswer = "Based on the document content, I found relevant information but the response was too lengthy. Please ask a more specific question for a clearer answer.";
        res.json({ answer: filteredAnswer });
      } else {
        console.log('✅ AI response generated successfully');
        res.json({ answer });
      }
      
    } catch (apiError) {
      console.log('❌ Gemini API failed, using intelligent fallback:', apiError.message);
      
      // Enhanced fallback response
      const fallbackAnswer = `Based on the document content, here are the most relevant sections for your question:

${relevantChunks[0].substring(0, 400)}${relevantChunks[0].length > 400 ? '...' : ''}

*Note: This is a text-based search result. For better AI analysis, please check your internet connection.*`;
      
      res.json({ answer: fallbackAnswer });
    }

  } catch (error) {
    console.error('Error answering question:', error);
    res.status(500).json({ 
      error: `Failed to answer question: ${error.message}` 
    });
  }
});

// Debug endpoint to check extracted text
app.get('/debug/text', (req, res) => {
  if (!documentText) {
    return res.json({ error: 'No document processed yet' });
  }
  
  res.json({
    total_length: documentText.length,
    chunks_count: processedChunks.length,
    sample: documentText.substring(0, 500),
    chunks_preview: processedChunks.slice(0, 2).map(chunk => chunk.substring(0, 200))
  });
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
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`🔍 Health check: http://localhost:${PORT}/health`);
  console.log(`🐛 Debug endpoint: http://localhost:${PORT}/debug/text`);
  
  if (!process.env.GOOGLE_API_KEY) {
    console.warn('⚠️  Warning: GOOGLE_API_KEY environment variable not set!');
  } else {
    console.log('✅ Google API key is configured');
  }
});

export default app;
