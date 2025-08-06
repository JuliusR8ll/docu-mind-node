import dotenv from 'dotenv';

dotenv.config();

console.log('🌐 Testing Network Connectivity for Google AI API\n');

// Test basic connectivity
async function testConnectivity() {
    console.log('1️⃣ Testing basic internet connectivity...');
    
    // Test 1: Basic fetch to a simple endpoint
    try {
        const response = await fetch('https://httpbin.org/status/200', {
            method: 'GET',
            signal: AbortSignal.timeout(10000)
        });
        console.log('✅ Basic HTTP request successful');
    } catch (error) {
        console.log('❌ Basic HTTP request failed:', error.message);
        console.log('   This indicates a fundamental network connectivity issue');
        return false;
    }

    // Test 2: Test Google's main domain
    try {
        const response = await fetch('https://www.google.com', {
            method: 'HEAD',
            signal: AbortSignal.timeout(10000)
        });
        console.log('✅ Google.com reachable');
    } catch (error) {
        console.log('❌ Google.com not reachable:', error.message);
        console.log('   This suggests DNS or firewall issues');
        return false;
    }

    // Test 3: Test the specific Google AI API domain
    try {
        const response = await fetch('https://generativelanguage.googleapis.com', {
            method: 'HEAD',
            signal: AbortSignal.timeout(10000)
        });
        console.log('✅ Google AI API domain reachable');
    } catch (error) {
        console.log('❌ Google AI API domain not reachable:', error.message);
        console.log('   This is the specific issue - the API domain is blocked');
        return false;
    }

    return true;
}

// Test with different proxy configurations
async function testWithProxy() {
    console.log('\n2️⃣ Testing proxy configuration...');
    
    // Check if proxy is configured
    const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
    const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
    
    if (httpProxy || httpsProxy) {
        console.log('📡 Proxy detected:');
        console.log(`   HTTP_PROXY: ${httpProxy || 'Not set'}`);
        console.log(`   HTTPS_PROXY: ${httpsProxy || 'Not set'}`);
    } else {
        console.log('📡 No proxy configuration detected');
        console.log('   In corporate environments, you might need to configure proxy settings');
    }
}

// Main test
async function runTests() {
    const connectivityOk = await testConnectivity();
    await testWithProxy();
    
    console.log('\n📊 Results:');
    
    if (connectivityOk) {
        console.log('✅ Network connectivity looks good!');
        console.log('🎯 Your "raw PDF content" issue is likely due to:');
        console.log('   • Text extraction problems in pdf2json');
        console.log('   • Poor prompt engineering');
        console.log('   • Missing response validation');
        console.log('\n💡 Solution: Use the improved server (npm run dev:improved)');
    } else {
        console.log('❌ Network connectivity issues detected!');
        console.log('\n🚫 This is why you\'re getting "raw PDF content":');
        console.log('   • Google AI API calls are failing due to network blocks');
        console.log('   • Your app falls back to returning raw extracted text');
        console.log('   • The text extraction itself has issues too');
        
        console.log('\n💡 Solutions:');
        console.log('   1. IMMEDIATE: Use improved server for better fallback responses');
        console.log('   2. NETWORK: Contact IT to unblock generativelanguage.googleapis.com');
        console.log('   3. ALTERNATIVE: Test from personal network (mobile hotspot)');
        console.log('   4. PROXY: Configure corporate proxy if needed');
        
        console.log('\n📞 Steps to take:');
        console.log('   1. Run: npm run dev:improved');
        console.log('   2. Test PDF upload and check /debug/text endpoint');
        console.log('   3. For full AI functionality, resolve network access');
    }
}

runTests().catch(console.error);
