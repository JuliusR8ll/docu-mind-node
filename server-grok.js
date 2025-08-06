import express from 'express';
import multer from 'multer';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8001;

// Initialize Grok AI (using OpenAI-compatible API)
const grok = new OpenAI({
  apiKey: process.env.GROK_API_KEY,
  baseURL: 'https://api.x.ai/v1'
});

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

// Enhanced text cleaning function for better PDF processing
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
    // Fix URL encoding
    .replace(/%20/g, ' ')
    .replace(/%3A/g, ':')
    .replace(/%2F/g, '/')
    // Remove email addresses and URLs (often not relevant content)
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]')
    .replace(/(https?|ftp):\/\/[^\s/$.?#].[^\s]*/g, '[URL]')
    .replace(/github\.com[^\s]*/g, '[GITHUB]')
    // Remove phone numbers
    .replace(/(\+\d{1,2}\s?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, '[PHONE]')
    // Clean up excessive whitespace
    .replace(/\s+/g, ' ')
    // Remove page numbers and headers/footers
    .replace(/^\s*\d+\s*$/gm, '')
    // Remove very short lines that might be artifacts
    .split('\n')
    .filter(line => {
      const cleanLine = line.trim();
      return cleanLine.length > 10 && 
             !cleanLine.match(/^[^a-zA-Z]*$/) && // Not just numbers/symbols
             !cleanLine.match(/^\s*[#$%&*@]+\s*$/); // Not just special chars
    })
    .join('\n')
    .trim();
}

// Improved text splitting function with better chunking for resumes and documents
function splitTextIntoChunks(text, chunkSize = 1200, chunkOverlap = 200) {
  const chunks = [];
  
  // Split by multiple patterns to identify sections better
  const patterns = [
    /\n\s*\n/,           // Double newlines (paragraphs)
    /\n(?=[A-Z][A-Z\s]+:)/,  // Lines that start with CAPS (section headers like EXPERIENCE:)
    /\n(?=\d{4}[-\s])/,     // Lines starting with years (dates)
    /\n(?=[•\-\*]\s)/      // Bullet points
  ];
  
  let sections = [text];
  
  // Apply each pattern to split further
  for (const pattern of patterns) {
    const newSections = [];
    for (const section of sections) {
      newSections.push(...section.split(pattern));
    }
    sections = newSections;
  }
  
  // Clean and filter sections
  sections = sections
    .map(s => s.trim())
    .filter(s => s.length > 20); // Keep meaningful sections
  
  let currentChunk = '';
  
  for (const section of sections) {
    // If adding this section would exceed chunk size, save current chunk
    if (currentChunk.length + section.length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      
      // Start new chunk with overlap from previous chunk
      const words = currentChunk.split(' ');
      const overlapWords = words.slice(-Math.min(30, words.length)); // Last 30 words as overlap
      currentChunk = overlapWords.join(' ') + '\n\n' + section;
    } else {
      if (currentChunk) currentChunk += '\n\n';
      currentChunk += section;
    }
  }
  
  // Add the last chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  // If we still have only one chunk but it's long, force split it
  if (chunks.length === 1 && chunks[0].length > chunkSize * 1.5) {
    const text = chunks[0];
    chunks.length = 0; // Clear array
    
    // Split by sentences or lines
    const sentences = text.split(/[.!?]\s+|\n/);
    currentChunk = '';
    
    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length > chunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        if (currentChunk) currentChunk += (sentence.includes('\n') ? '' : '. ');
        currentChunk += sentence;
      }
    }
    
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
  }
  
  return chunks.filter(chunk => chunk.length > 50); // Filter out very small chunks
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
  res.json({ status: 'OK', message: 'Server is running with Grok AI', ai_provider: 'xAI Grok' });
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
      sample_text: finalText.substring(0, 200) + '...',
      ai_provider: 'xAI Grok'
    });

  } catch (error) {
    console.error('Error processing PDF:', error);
    res.status(500).json({ 
      error: `PDF processing failed: ${error.message}` 
    });
  }
});

// Enhanced answer question endpoint using Grok
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
        answer: "I couldn't find relevant information in the document to answer your question. Please try rephrasing your question or asking about different topics that might be covered in the document.",
        ai_provider: 'xAI Grok'
      });
    }

    const context = relevantChunks.join('\n\n---\n\n');
    console.log(`📄 Using ${relevantChunks.length} relevant chunks (${context.length} characters)`);

    try {
      // Enhanced prompt for better responses using Grok
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

      console.log('🤖 Calling Grok API...');
      
      const completion = await grok.chat.completions.create({
        model: 'grok-beta',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.8,
        max_tokens: 800,
      });
      
      const answer = completion.choices[0].message.content;
      
      // Validate that the response is not just raw text
      if (answer.length > context.length * 0.8) {
        console.warn('⚠️ Response seems to be mostly raw text, filtering...');
        const filteredAnswer = "Based on the document content, I found relevant information but the response was too lengthy. Please ask a more specific question for a clearer answer.";
        res.json({ answer: filteredAnswer, ai_provider: 'xAI Grok' });
      } else {
        console.log('✅ Grok AI response generated successfully');
        res.json({ answer, ai_provider: 'xAI Grok' });
      }
      
    } catch (apiError) {
      console.log('❌ Grok API failed, using intelligent fallback:', apiError.message);
      
      // Improved fallback that analyzes content by type instead of dumping raw text
      let fallbackAnswer = "";
      
      // Check question type and provide formatted response
      const questionLower = user_question.toLowerCase();
      
    //   if (questionLower.includes('about') || questionLower.includes('summary') || questionLower.includes('what is')) {
    //     // Document summary questions
    //     fallbackAnswer = "Based on the document content, this appears to be a resume or CV that includes professional experience, education, and skills information. The document is structured with sections for different aspects of the person's background.";
    //   } 
    //   else if (questionLower.includes('experience') || questionLower.includes('work') || questionLower.includes('job')) {
    //     // Experience-related questions
    //     fallbackAnswer = "The document contains work experience information, including roles, dates, and responsibilities. The experience section mentions technologies and projects worked on.";
    //   }
    //   else if (questionLower.includes('education') || questionLower.includes('degree') || questionLower.includes('school')) {
    //     // Education-related questions
    //     fallbackAnswer = "The document includes education information, such as degrees obtained, institutions attended, and graduation dates.";
    //   }
    //   else if (questionLower.includes('skill') || questionLower.includes('technology') || questionLower.includes('programming')) {
    //     // Skills-related questions
    //     fallbackAnswer = "The document mentions various technical skills and technologies the person is proficient in.";
    //   }
    //   else if (questionLower.includes('project') || questionLower.includes('built') || questionLower.includes('developed')) {
    //     // Project-related questions
    //     fallbackAnswer = "The document describes projects the person has worked on, including technologies used and outcomes achieved.";
    //   }
    //   else {
    //     // General fallback for other questions
    //     fallbackAnswer = `I found relevant information in the document, but I need to be more specific. Try asking about particular aspects like experience, education, skills, or projects.`;
    //   }
      
    //   fallbackAnswer += "\n\n*Note: This is a text analysis summary. Due to API connectivity issues, I cannot provide detailed AI analysis.*";
      
      res.json({ answer: fallbackAnswer, ai_provider: 'Smart Fallback (Grok unavailable)' });
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
    chunks_preview: processedChunks.slice(0, 2).map(chunk => chunk.substring(0, 200)),
    ai_provider: 'xAI Grok'
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
  console.log(`🚀 Server is running on port ${PORT} with Grok AI`);
  console.log(`🔍 Health check: http://localhost:${PORT}/health`);
  console.log(`🐛 Debug endpoint: http://localhost:${PORT}/debug/text`);
  
  if (!process.env.GROK_API_KEY) {
    console.warn('⚠️  Warning: GROK_API_KEY environment variable not set!');
  } else {
    console.log('✅ Grok API key is configured');
  }
});

export default app;
