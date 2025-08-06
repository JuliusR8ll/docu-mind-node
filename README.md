# Docu-Mind Backend (Node.js)

A Node.js backend for the Docu-Mind PDF chatbot that allows users to upload PDF documents and ask questions about their content using Google's Gemini AI.

## Features

- PDF file upload and text extraction
- Document text chunking and embedding generation
- Similarity search using cosine similarity
- Question answering using Google Gemini AI
- CORS enabled for cross-origin requests
- Error handling and validation

## Prerequisites

- Node.js 18+ installed
- Google Gemini API key

## Installation

1. Clone or navigate to the backend directory:
```bash
cd docu-mind-node
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory:
```bash
cp .env.example .env
```

4. Add your Google API key to the `.env` file:
```
GOOGLE_API_KEY=your_google_gemini_api_key_here
PORT=8000
```

## Usage

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

The server will start on `http://localhost:8000` (or the port specified in your `.env` file).

## API Endpoints

### Health Check
- **GET** `/health`
- Returns server status

### Process PDFs
- **POST** `/process_pdf`
- Upload and process PDF files
- Body: `multipart/form-data` with `pdf_docs` field containing PDF files
- Response: Processing status and number of chunks created

### Ask Question
- **POST** `/answer_question`
- Ask a question about the processed PDFs
- Body: `{ "user_question": "Your question here" }`
- Response: `{ "answer": "AI generated answer" }`

## How It Works

1. **PDF Processing**: Extracts text from uploaded PDF files using `pdf-parse`
2. **Text Chunking**: Splits the extracted text into manageable chunks with overlaps
3. **Embeddings**: Generates embeddings for each text chunk using Google's embedding model
4. **Vector Storage**: Stores chunks and their embeddings in memory
5. **Similarity Search**: When a question is asked, finds the most relevant chunks using cosine similarity
6. **Answer Generation**: Uses Google Gemini to generate answers based on relevant context

## Dependencies

- **express**: Web framework
- **multer**: File upload middleware
- **pdf-parse**: PDF text extraction
- **cors**: Cross-origin resource sharing
- **dotenv**: Environment variables
- **@google/generative-ai**: Google AI SDK
- **axios**: HTTP client (for potential external API calls)

## Error Handling

The API includes comprehensive error handling for:
- File upload errors (size limits, file type validation)
- PDF processing errors
- AI model errors
- Network errors

## Limitations

- In-memory storage (data is lost when server restarts)
- 10MB file size limit
- Rate limiting may apply based on Google API quotas

## Security Considerations

- File type validation (PDF only)
- File size limits
- Input sanitization
- Error message sanitization

## License

MIT License
