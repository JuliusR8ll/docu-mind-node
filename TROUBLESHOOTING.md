# 🔧 Troubleshooting Guide: "Getting Just PDF Content" Issue

## 🎯 Quick Fix Steps

### 1. **Use the Improved Server**
```bash
npm run dev:improved
```

The improved server (`server-improved.js`) has better:
- Text extraction and cleaning
- Intelligent chunking
- Response validation
- Better error handling

### 2. **Check Your PDF Text Extraction**
After uploading a PDF, visit: `http://localhost:8000/debug/text`

This will show you:
- How much text was extracted
- Quality of the extracted text
- Sample of what the AI sees

### 3. **Test Your API Connection**
```bash
npm run debug:gemini
```

This will test your Google AI API connection and identify issues.

### 4. **Run PDF Processing Tests**
```bash
npm run test:pdf
```

This tests text cleaning, chunking, and AI response quality.

---

## 🔍 Diagnosing the Problem

### Common Causes of "Raw PDF Content" Responses:

#### **1. Poor Text Extraction**
**Symptoms:** 
- Responses contain garbled text
- Special characters and encoding issues
- Text seems fragmented

**Solution:** 
- Use the improved server with better text cleaning
- Check `/debug/text` endpoint to see extracted text quality

#### **2. API Failure with Poor Fallback**
**Symptoms:**
- Getting large chunks of raw text as answers
- Responses are longer than questions warrant

**Solution:**
- Check console logs for API errors
- Run `npm run debug:gemini` to test API connection
- Verify your Google API key is working

#### **3. Wrong Prompt Structure**
**Symptoms:**
- AI returns full context instead of answering
- Responses don't follow expected format

**Solution:**
- The improved server uses better prompt engineering
- Validates response length vs. context length

#### **4. Context Overload**
**Symptoms:**
- AI gets confused with too much information
- Returns raw chunks instead of processing them

**Solution:**
- Improved chunking algorithm finds relevant sections
- Better context selection based on question

---

## 🧪 Testing Steps

### Step 1: Test with a Simple PDF
1. Create a simple PDF with clear text (not scanned images)
2. Upload it using the improved server
3. Check `/debug/text` to verify text extraction
4. Ask a simple question like "What is this document about?"

### Step 2: Monitor Console Logs
Watch for these logs:
```
✅ Extracted X characters from filename.pdf
📄 Total text length: X characters
📦 Created X chunks
❓ Answering question: "your question"
📄 Using X relevant chunks (X characters)
✅ AI response generated successfully
```

### Step 3: Check Response Quality
Good responses should be:
- Shorter than the source context
- Directly answer the question
- Not contain raw PDF artifacts

---

## ⚙️ Configuration Fixes

### Environment Variables (.env file)
```env
GOOGLE_API_KEY=your_actual_api_key_here
PORT=8000
```

### Model Settings (in server-improved.js)
```javascript
model: 'gemini-1.5-flash',
generationConfig: {
  temperature: 0.2,  // Lower = more focused responses
  maxOutputTokens: 800,  // Limit response length
}
```

---

## 🐛 Common Issues & Solutions

### Issue: "No text extracted from PDF"
**Cause:** PDF contains only images/scanned content
**Solution:** 
- Use OCR-enabled PDFs or text-based PDFs
- Consider adding OCR capability (tesseract.js)

### Issue: "API key not working"
**Cause:** Invalid or restricted API key
**Solution:**
- Verify API key in Google Cloud Console
- Enable the Generative AI API
- Check API quotas and billing

### Issue: "Network/fetch errors"
**Cause:** Corporate firewall or proxy issues
**Solution:**
- Test from personal network (mobile hotspot)
- Configure proxy settings if needed
- Check with IT department about API access

### Issue: "Responses are too long/repetitive"
**Cause:** AI is copying context instead of answering
**Solution:**
- The improved server has response validation
- Better prompt engineering prevents this
- Context length limits prevent overload

---

## 📊 Performance Monitoring

### What to Monitor:
1. **Text Extraction Quality**
   - Characters extracted vs. PDF size
   - Presence of encoding issues
   - Chunk count and sizes

2. **API Response Times**
   - Watch for timeouts or slow responses
   - Monitor API quotas and limits

3. **Response Quality**
   - Answer relevance to question
   - Response length appropriateness
   - Absence of raw PDF artifacts

### Good Indicators:
- ✅ Clean text extraction (readable sentences)
- ✅ Relevant context selection (2-3 chunks max)
- ✅ Concise, focused answers
- ✅ Fast API response times (<5 seconds)

### Bad Indicators:
- ❌ Garbled or fragmented text
- ❌ Very long responses that copy context
- ❌ Irrelevant or generic answers
- ❌ Frequent API failures

---

## 🚀 Next Steps

1. **Switch to improved server:** `npm run dev:improved`
2. **Test with sample PDF:** Use `/debug/text` endpoint
3. **Verify API connection:** `npm run debug:gemini`
4. **Monitor logs:** Watch console output during testing
5. **Test different PDF types:** Try various document formats

---

## 📞 Still Having Issues?

If you're still getting raw PDF content as responses:

1. **Check the console logs** for specific error messages
2. **Test the `/debug/text` endpoint** to see what text is being extracted
3. **Try the `npm run test:pdf` command** to test the processing pipeline
4. **Verify your Google API key** is working with `npm run debug:gemini`

The improved server should resolve most of these issues with better text processing and response validation.
