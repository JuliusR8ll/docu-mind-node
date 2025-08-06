import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import https from 'https';
import http from 'http';

dotenv.config();

console.log('🔍 Debugging Gemini API Connection...\n');

// 1. Check API Key
console.log('1️⃣ Checking API Key...');
const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
    console.log('❌ GOOGLE_API_KEY not found in environment variables');
    process.exit(1);
} else {
    console.log(`✅ API Key found: ${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 4)}`);
}

// 2. Check basic network connectivity
console.log('\n2️⃣ Testing network connectivity...');

// Test DNS resolution
function testDNS() {
    return new Promise(async (resolve) => {
        try {
            const dns = await import('dns');
            dns.default.lookup('generativelanguage.googleapis.com', (err, address) => {
                if (err) {
                    console.log('❌ DNS Resolution failed:', err.message);
                    resolve(false);
                } else {
                    console.log(`✅ DNS Resolution successful: ${address}`);
                    resolve(true);
                }
            });
        } catch (importError) {
            console.log('❌ DNS test failed:', importError.message);
            resolve(false);
        }
    });
}

// Test HTTPS connection
function testHTTPSConnection() {
    return new Promise((resolve) => {
        const options = {
            hostname: 'generativelanguage.googleapis.com',
            port: 443,
            path: '/',
            method: 'GET',
            timeout: 5000
        };

        const req = https.request(options, (res) => {
            console.log(`✅ HTTPS Connection successful: ${res.statusCode} ${res.statusMessage}`);
            resolve(true);
        });

        req.on('error', (err) => {
            console.log('❌ HTTPS Connection failed:', err.message);
            resolve(false);
        });

        req.on('timeout', () => {
            console.log('❌ HTTPS Connection timeout');
            req.destroy();
            resolve(false);
        });

        req.end();
    });
}

// 3. Test Google AI SDK initialization
console.log('\n3️⃣ Testing Google AI SDK initialization...');
try {
    const genAI = new GoogleGenerativeAI(apiKey);
    console.log('✅ GoogleGenerativeAI SDK initialized successfully');
    
    // 4. Test model access
    console.log('\n4️⃣ Testing model access...');
    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        console.log('✅ Model instance created successfully');
        
        // 5. Test API call with detailed error handling
        console.log('\n5️⃣ Testing API call...');
        
        const testPrompt = "Hello, can you respond with just 'API working'?";
        
        try {
            console.log('📡 Making API request...');
            const result = await model.generateContent(testPrompt);
            const response = result.response.text();
            console.log('✅ API call successful!');
            console.log('📝 Response:', response);
            
        } catch (apiError) {
            console.log('❌ API call failed with detailed error:');
            console.log('Error name:', apiError.name);
            console.log('Error message:', apiError.message);
            
            if (apiError.cause) {
                console.log('Error cause:', apiError.cause);
            }
            
            if (apiError.stack) {
                console.log('Error stack:', apiError.stack.split('\n').slice(0, 5).join('\n'));
            }
            
            // Check for specific error types
            if (apiError.message.includes('fetch failed')) {
                console.log('\n🔍 Network-related error detected. Possible causes:');
                console.log('   • Corporate firewall blocking external APIs');
                console.log('   • Proxy configuration needed');
                console.log('   • DNS resolution issues');
                console.log('   • SSL/TLS certificate issues');
                
                // Test basic fetch
                console.log('\n📡 Testing basic fetch to Google...');
                try {
                    const response = await fetch('https://www.google.com', { 
                        method: 'HEAD',
                        signal: AbortSignal.timeout(5000)
                    });
                    console.log('✅ Basic fetch to google.com successful');
                } catch (fetchError) {
                    console.log('❌ Basic fetch failed:', fetchError.message);
                }
            }
            
            if (apiError.message.includes('API key')) {
                console.log('\n🔍 API key related error detected');
                console.log('   • Check if API key is valid');
                console.log('   • Check if Generative AI API is enabled');
                console.log('   • Check API key permissions');
            }
        }
        
    } catch (modelError) {
        console.log('❌ Model creation failed:', modelError.message);
    }
    
} catch (sdkError) {
    console.log('❌ SDK initialization failed:', sdkError.message);
}

// 6. Environment diagnostics
console.log('\n6️⃣ Environment diagnostics...');
console.log('Node.js version:', process.version);
console.log('Platform:', process.platform);
console.log('Architecture:', process.arch);

// Check proxy environment variables
const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const noProxy = process.env.NO_PROXY || process.env.no_proxy;

console.log('HTTP_PROXY:', httpProxy || 'Not set');
console.log('HTTPS_PROXY:', httpsProxy || 'Not set');
console.log('NO_PROXY:', noProxy || 'Not set');

// 7. Run network tests
console.log('\n7️⃣ Running network tests...');
const dnsOk = await testDNS();
const httpsOk = await testHTTPSConnection();

console.log('\n📊 Diagnostic Summary:');
console.log('DNS Resolution:', dnsOk ? '✅' : '❌');
console.log('HTTPS Connection:', httpsOk ? '✅' : '❌');
console.log('API Key Present:', apiKey ? '✅' : '❌');

if (!dnsOk || !httpsOk) {
    console.log('\n🚫 Network connectivity issues detected!');
    console.log('💡 Recommended solutions:');
    console.log('   1. Check corporate firewall settings');
    console.log('   2. Configure proxy if required');
    console.log('   3. Contact IT support for external API access');
    console.log('   4. Try from personal network (mobile hotspot)');
}

console.log('\n🔚 Diagnostic complete.');
