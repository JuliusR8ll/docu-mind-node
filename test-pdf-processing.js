import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

console.log('🧪 Testing PDF Processing and AI Response Quality\n');

// Test the text cleaning function
function testTextCleaning() {
  console.log('1️⃣ Testing text cleaning...');
  
  const rawText = `This  is   a   test   document    with  weird   spacing.
  %20This%20has%20URL%20encoding%20issues%20.
  1
  2
  
  Short line
  Another normal sentence with proper content that should be preserved.`;
  
  const cleaned = cleanExtractedText(rawText);
  console.log('Raw text length:', rawText.length);
  console.log('Cleaned text length:', cleaned.length);
  console.log('Cleaned text sample:', cleaned.substring(0, 100));
  
  return cleaned;
}

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

// Test AI response with different prompt styles
async function testAIResponses() {
  console.log('\n2️⃣ Testing AI response quality...');
  
  if (!process.env.GOOGLE_API_KEY) {
    console.log('❌ No Google API key found. Skipping AI tests.');
    return;
  }

  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  
  const testContext = `
The company XYZ Corp was founded in 2010 by John Smith and Jane Doe. 
It specializes in software development and has 50 employees. 
The headquarters is located in New York City.
Annual revenue for 2023 was $10 million.
The company offers web development, mobile apps, and consulting services.
`;

  const testQuestions = [
    "Who founded the company?",
    "What services does the company offer?",
    "How many employees does the company have?",
  ];

  for (const question of testQuestions) {
    console.log(`\n❓ Testing question: "${question}"`);
    
    // Test different prompt styles
    const prompts = [
      // Simple prompt (what you might be using)
      `Context: ${testContext}\nQuestion: ${question}\nAnswer:`,
      
      // Enhanced prompt (what the improved server uses)
      `You are a helpful assistant that answers questions based on provided document content.

INSTRUCTIONS:
1. Answer the question accurately based ONLY on the provided context
2. If the answer is not in the context, clearly state "The answer is not available in the provided document"
3. Be concise but complete in your response
4. Do not repeat large chunks of the original text

CONTEXT:
${testContext}

QUESTION: ${question}

ANSWER:`
    ];
    
    for (let i = 0; i < prompts.length; i++) {
      try {
        const result = await model.generateContent(prompts[i]);
        const answer = result.response.text();
        
        console.log(`  Prompt ${i + 1} (${i === 0 ? 'Simple' : 'Enhanced'}):`);
        console.log(`  Response length: ${answer.length} chars`);
        console.log(`  Response: ${answer.substring(0, 150)}${answer.length > 150 ? '...' : ''}`);
        
        // Check if response is just regurgitating context
        const contextWords = testContext.toLowerCase().split(/\s+/);
        const responseWords = answer.toLowerCase().split(/\s+/);
        const overlap = contextWords.filter(word => responseWords.includes(word)).length;
        const overlapPercentage = (overlap / responseWords.length) * 100;
        
        console.log(`  Context overlap: ${overlapPercentage.toFixed(1)}% ${overlapPercentage > 70 ? '❌ (Too high)' : '✅'}`);
        
      } catch (error) {
        console.log(`  ❌ Error with prompt ${i + 1}:`, error.message);
      }
      
      console.log('');
    }
  }
}

// Test chunking strategy
function testChunking() {
  console.log('\n3️⃣ Testing text chunking...');
  
  const longText = Array(20).fill("This is a sample paragraph that contains meaningful content about various topics. ").join('') +
    "\n\nThis is a new section with different information. " +
    Array(15).fill("More content here that should be grouped properly. ").join('');
  
  console.log(`Original text length: ${longText.length} characters`);
  
  const chunks = splitTextIntoChunks(longText, 200, 50);
  console.log(`Created ${chunks.length} chunks:`);
  
  chunks.forEach((chunk, index) => {
    console.log(`  Chunk ${index + 1}: ${chunk.length} chars - "${chunk.substring(0, 50)}..."`);
  });
}

function splitTextIntoChunks(text, chunkSize = 8000, chunkOverlap = 500) {
  const chunks = [];
  
  // Split by major sections (double newlines)
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
  
  return chunks.filter(chunk => chunk.length > 100);
}

// Main test function
async function runTests() {
  try {
    testTextCleaning();
    testChunking();
    await testAIResponses();
    
    console.log('\n🎯 Recommendations:');
    console.log('1. Use the improved server-improved.js file');
    console.log('2. Check the /debug/text endpoint after uploading a PDF');
    console.log('3. Monitor console logs for text extraction quality');
    console.log('4. Test with different types of PDF files');
    console.log('5. Verify your Google API key is working with the debug-gemini.js script');
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

runTests();
