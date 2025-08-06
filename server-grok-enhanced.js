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

// Advanced text cleaning for resumes and complex documents
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
    // Remove email addresses
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
    // Remove URLs
    .replace(/(https?|ftp):\/\/[^\s/$.?#].[^\s]*/g, '')
    // Remove phone numbers
    .replace(/(\+\d{1,2}\s?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, '')
    // Fix spacing issues from PDF extraction
    .replace(/(\w)\s+(\w)/g, '$1 $2') // Ensure single space between words
    .replace(/\s{2,}/g, ' ') // Replace multiple spaces with single space
    // Remove special characters that are not part of sentences
    .replace(/[^a-zA-Z0-9.,\s-]/g, '') 
    // Remove very short lines that might be artifacts
    .split('\n')
    .filter(line => line.trim().length > 10)
    .join('\n')
    .trim();
}

// Advanced chunking strategy
function splitTextIntoChunks(text, chunkSize = 1500, chunkOverlap = 200) {
  const chunks = [];
  let start = 0;
  
  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);
    
    // Find the last natural break point
    const lastSpace = text.lastIndexOf(' ', end);
    if (lastSpace !== -1 && end < text.length) {
      end = lastSpace;
    }
    
    chunks.push(text.slice(start, end));
    start = end - chunkOverlap;
  }
  
  return chunks;
}

// API Routes (same as before)
// ...

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Enhanced Grok server running on port ${PORT}`);
});

export default app;
